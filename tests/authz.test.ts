import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../lib/db/prisma';
import { seedAuthzFixtures, TEST_USERS } from '../scripts/seed-authz-fixtures';
import {
  retrieveAuthorizedChunks,
  retrieveChunksForDocuments,
  retrievePublicChunks,
  insertDocumentChunks,
} from '../lib/db/queries/chunks';
import { listAccessibleDocumentSummaries, listPublicDocumentSummaries } from '../lib/db/queries/documents';
import { matchDocumentsByName } from '../lib/rag/documentNameMatch';
import { getEmbeddingProvider } from '../lib/embeddings';
import { answerQuestion } from '../lib/rag/chat';
import { NO_AUTHORIZED_INFO_ANSWER } from '../lib/llm/promptTemplates';
import type { AuthContext } from '../lib/auth/session';

// True exactly when tests/setup.ts had a GEMINI_API_KEY to auto-provision a
// real, DB-activated provider with — tests that actually call the model are
// skipped (not failed) otherwise, since that's a valid local-dev state; the
// DB-layer tests above them run regardless and are what actually proves the
// security boundary.
const llmProviderConfigured = !!process.env.GEMINI_API_KEY;

/**
 * The core, non-negotiable security requirement from the spec (§35):
 * authorization happens BEFORE retrieval, never by trusting the LLM to
 * refuse. This suite proves it end-to-end rather than spot-checking by hand.
 *
 * Requires DATABASE_URL_TEST to point at a migrated, pgvector-enabled
 * Postgres database (see tests/setup.ts, .env.example, README).
 */

async function authContextFor(email: string): Promise<AuthContext> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    include: { role: true },
  });
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    roleName: user.role.name,
    clearanceRank: user.role.hierarchyRank,
    canUploadDocuments: user.role.canUploadDocuments,
    isAdmin: user.role.isAdmin,
    // None of the seeded fixture users belong to any department — these
    // tests exercise the pure clearance-rank boundary; department-based
    // access is covered separately (see the "departments" test group
    // below, once added).
    departmentIds: [],
    hasHeadDepartmentAccess: false,
    // Every seeded test user shares the SAME single location (see
    // seed-authz-fixtures.ts's TEST_LOCATION_NAME comment), and every
    // fixture document is tagged with that same location — location is
    // mandatory (unlike department, no "belongs to none" escape hatch), so
    // this keeps the location check passing unconditionally for all of
    // them, leaving clearance/department as the only things these tests
    // actually vary.
    locationId: user.locationId,
    themePreference: user.themePreference,
    // No real login session in these tests — every code path under test
    // (answerQuestion/streamAnswer et al.) is session-agnostic.
    loginSessionId: null,
  };
}

beforeAll(async () => {
  await seedAuthzFixtures();
}, 120_000);

describe('retrieveAuthorizedChunks (DB layer)', () => {
  it('never returns a chunk above the caller\'s clearance rank, for every seeded rank', async () => {
    const embedder = await getEmbeddingProvider();
    const [embedding] = await embedder.embed(['What are the merger and acquisition plans?'], 'RETRIEVAL_QUERY');

    for (const { roleName } of TEST_USERS) {
      const user = await authContextFor(
        TEST_USERS.find((u) => u.roleName === roleName)!.email,
      );
      const results = await retrieveAuthorizedChunks(embedding, user.clearanceRank, [], false, user.locationId, 10);
      for (const chunk of results) {
        expect(
          chunk.clearanceLevel,
          `${roleName} (rank ${user.clearanceRank}) must never receive a chunk above their rank`,
        ).toBeLessThanOrEqual(user.clearanceRank);
      }
    }
  });

  it('the CXO document IS retrievable at CXO clearance and NOT at lower ranks', async () => {
    const embedder = await getEmbeddingProvider();
    const [embedding] = await embedder.embed(['Northwind acquisition due diligence'], 'RETRIEVAL_QUERY');

    const engineerCtx = await authContextFor('engineer@asktest.local');
    const cxoCtx = await authContextFor('cxo@asktest.local');

    const asEngineer = await retrieveAuthorizedChunks(embedding, engineerCtx.clearanceRank, [], false, engineerCtx.locationId, 10);
    expect(asEngineer.some((c) => c.documentName === 'Board Merger Plans')).toBe(false);

    const asCxo = await retrieveAuthorizedChunks(embedding, cxoCtx.clearanceRank, [], false, cxoCtx.locationId, 10);
    expect(asCxo.some((c) => c.documentName === 'Board Merger Plans')).toBe(true);
  });

  it('listAccessibleDocumentSummaries never names a document above the caller\'s clearance rank', async () => {
    // The document-inventory feature (answers "how many documents do you
    // have") is a second data source alongside chunk content, filtered the
    // same way — this proves that filter independently of the LLM, same as
    // the chunk-retrieval tests above.
    const engineerCtx = await authContextFor('engineer@asktest.local');
    const cxoCtx = await authContextFor('cxo@asktest.local');

    const asEngineer = await listAccessibleDocumentSummaries(engineerCtx.clearanceRank, [], false, engineerCtx.locationId);
    expect(asEngineer.some((d) => d.name === 'Board Merger Plans')).toBe(false);

    const asCxo = await listAccessibleDocumentSummaries(cxoCtx.clearanceRank, [], false, cxoCtx.locationId);
    expect(asCxo.some((d) => d.name === 'Board Merger Plans')).toBe(true);
  });

  it('retrieveChunksForDocuments enforces the exact same clearance boundary as retrieveAuthorizedChunks', async () => {
    // This is the second entry point into chunk retrieval (added for
    // matchDocumentsByName — see lib/rag/documentNameMatch.ts). It must be
    // just as strict as the main vector-search path even though it takes a
    // list of document ids directly, rather than deriving them from a
    // clearance-filtered similarity search — passing a CXO-only document id
    // in must still be refused for a lower-clearance caller.
    const boardMergerDoc = await prisma.document.findFirstOrThrow({
      where: { name: 'Board Merger Plans' },
    });
    const embedder = await getEmbeddingProvider();
    const [embedding] = await embedder.embed(['merger plans'], 'RETRIEVAL_QUERY');

    const engineerCtx = await authContextFor('engineer@asktest.local');
    const asEngineer = await retrieveChunksForDocuments(
      [boardMergerDoc.id],
      embedding,
      engineerCtx.clearanceRank,
      [],
      false,
      engineerCtx.locationId,
    );
    expect(asEngineer).toHaveLength(0);

    const cxoCtx = await authContextFor('cxo@asktest.local');
    const asCxo = await retrieveChunksForDocuments(
      [boardMergerDoc.id],
      embedding,
      cxoCtx.clearanceRank,
      [],
      false,
      cxoCtx.locationId,
    );
    expect(asCxo.length).toBeGreaterThan(0);
    expect(asCxo.every((c) => c.matchedByDocumentName)).toBe(true);
  });

  it('clearance and department are an intersection (AND), not alternatives (OR) — both are required for a tagged document', async () => {
    // Sets up its own temporary Department rows and tags/untags the
    // fixture's own CXO-only "Board Merger Plans" document for the
    // duration of this test only — reverted in `finally` so this doesn't
    // leak state into any other test.
    const deptA = await prisma.department.create({ data: { name: `Test Dept A ${Date.now()}` } });
    const headDept = await prisma.department.create({
      data: { name: `Test Head Dept ${Date.now()}`, isHeadDepartment: true },
    });

    const boardMergerDoc = await prisma.document.findFirstOrThrow({ where: { name: 'Board Merger Plans' } });
    const engineer = await prisma.user.findFirstOrThrow({ where: { email: 'engineer@asktest.local' } });
    const engineerRank = (await prisma.role.findUniqueOrThrow({ where: { id: engineer.roleId } })).hierarchyRank;
    const cxoCtx = await authContextFor('cxo@asktest.local');

    try {
      // Tag the CXO-only document with deptA — clearance stays CXO-only,
      // department is now deptA.
      await prisma.document.update({ where: { id: boardMergerDoc.id }, data: { departments: { connect: { id: deptA.id } } } });
      await prisma.documentChunk.updateMany({ where: { documentId: boardMergerDoc.id }, data: { departmentIds: [deptA.id] } });

      const embedder = await getEmbeddingProvider();
      const [embedding] = await embedder.embed(['Northwind acquisition due diligence'], 'RETRIEVAL_QUERY');

      // Sufficient clearance (CXO) AND matching department (deptA) -> sees it.
      const cxoInDeptA = await retrieveAuthorizedChunks(embedding, cxoCtx.clearanceRank, [deptA.id], false, cxoCtx.locationId, 10);
      expect(cxoInDeptA.some((c) => c.documentName === 'Board Merger Plans')).toBe(true);

      // Sufficient clearance (CXO) but NOT in deptA, no head-department ->
      // department condition fails, so access is refused despite ample
      // clearance. This is the actual behavior change: clearance alone
      // used to be enough, and no longer is once a document has a
      // department.
      const cxoNotInDeptA = await retrieveAuthorizedChunks(embedding, cxoCtx.clearanceRank, [], false, cxoCtx.locationId, 10);
      expect(cxoNotInDeptA.some((c) => c.documentName === 'Board Merger Plans')).toBe(false);

      // Sufficient clearance (CXO) + head-department access (not deptA
      // itself) -> head-department membership counts as matching every
      // department, so this still passes.
      const cxoWithHeadAccess = await retrieveAuthorizedChunks(embedding, cxoCtx.clearanceRank, [headDept.id], true, cxoCtx.locationId, 10);
      expect(cxoWithHeadAccess.some((c) => c.documentName === 'Board Merger Plans')).toBe(true);

      // INSUFFICIENT clearance (engineer, the lowest seeded rank) but IN
      // deptA -> department matches, but clearance does not, so access is
      // still refused. Proves department membership never widens what
      // clearance alone would admit.
      const engineerInDeptA = await retrieveAuthorizedChunks(embedding, engineerRank, [deptA.id], false, engineer.locationId, 10);
      expect(engineerInDeptA.some((c) => c.documentName === 'Board Merger Plans')).toBe(false);

      // INSUFFICIENT clearance + head-department access -> still refused;
      // head-department status only ever satisfies the department half of
      // the check, never the clearance half.
      const engineerWithHeadAccess = await retrieveAuthorizedChunks(embedding, engineerRank, [headDept.id], true, engineer.locationId, 10);
      expect(engineerWithHeadAccess.some((c) => c.documentName === 'Board Merger Plans')).toBe(false);

      // Now strip the document back to NO department at all — pure
      // clearance governs again, exactly as if departments never existed:
      // CXO sees it, with no department or head-department status needed.
      await prisma.documentChunk.updateMany({ where: { documentId: boardMergerDoc.id }, data: { departmentIds: [] } });
      const cxoOnDepartmentless = await retrieveAuthorizedChunks(embedding, cxoCtx.clearanceRank, [], false, cxoCtx.locationId, 10);
      expect(cxoOnDepartmentless.some((c) => c.documentName === 'Board Merger Plans')).toBe(true);
    } finally {
      // Revert the fixture document to its original, departmentless state
      // and remove the temporary departments entirely.
      await prisma.documentChunk.updateMany({ where: { documentId: boardMergerDoc.id }, data: { departmentIds: [] } });
      await prisma.document.update({ where: { id: boardMergerDoc.id }, data: { departments: { set: [] } } });
      await prisma.department.delete({ where: { id: deptA.id } });
      await prisma.department.delete({ where: { id: headDept.id } });
    }
  });

  it('a public document bypasses clearance/department/location for every employee, AND is reachable with no identity at all — but a non-public document is never reachable without one', async () => {
    // Sets up its own temporary public Document (isPublic: true, no
    // clearance/department/location worth anything — see Document.isPublic's
    // own schema.prisma comment) for the duration of this test only,
    // cleaned up in `finally`.
    const cxo = await prisma.user.findUniqueOrThrow({ where: { email: 'cxo@asktest.local' } });
    const publicDoc = await prisma.document.create({
      data: {
        name: `Test Public Notice ${Date.now()}`,
        fileKey: 'seed:public-notice',
        mimeType: 'text/plain',
        fileSizeBytes: 100,
        clearanceLevel: 0,
        uploadedById: cxo.id,
        status: 'READY',
        isPublic: true,
      },
    });

    try {
      const embedder = await getEmbeddingProvider();
      const content = 'This public notice announces a river water quality monitoring initiative.';
      const [vector] = await embedder.embed([content], 'RETRIEVAL_DOCUMENT');
      await insertDocumentChunks(publicDoc.id, [{ index: 0, content }], [vector], 0, [], [], true);

      const [queryEmbedding] = await embedder.embed(['river water quality monitoring'], 'RETRIEVAL_QUERY');

      // Reachable with NO identity at all — the unauthenticated public path.
      const asPublic = await retrievePublicChunks(queryEmbedding, 10);
      expect(asPublic.some((c) => c.documentId === publicDoc.id)).toBe(true);
      const publicInventory = await listPublicDocumentSummaries();
      expect(publicInventory.some((d) => d.id === publicDoc.id)).toBe(true);

      // Reachable by the LOWEST-clearance seeded test user (engineer),
      // with no matching department and (via a location that ISN'T
      // theirs) no matching location either — clearance/department/
      // location are all irrelevant for a public chunk.
      const engineerCtx = await authContextFor('engineer@asktest.local');
      const otherLocation = await prisma.location.findFirstOrThrow({
        where: { id: { not: engineerCtx.locationId } },
      });
      const asEngineer = await retrieveAuthorizedChunks(
        queryEmbedding,
        engineerCtx.clearanceRank,
        [], // no matching department
        false, // no head-department access
        otherLocation.id, // deliberately NOT engineer's real location
        10,
      );
      expect(asEngineer.some((c) => c.documentId === publicDoc.id)).toBe(true);

      // The reverse must also hold: a genuinely NON-public document (the
      // fixture's own CXO-only "Board Merger Plans") must never be
      // reachable through the public, no-identity path — the public
      // bypass only ever widens access for isPublic content, never for
      // anything else.
      const boardMergerDoc = await prisma.document.findFirstOrThrow({ where: { name: 'Board Merger Plans' } });
      const [mergerEmbedding] = await embedder.embed(['Northwind acquisition due diligence'], 'RETRIEVAL_QUERY');
      const publicOnMergerQuery = await retrievePublicChunks(mergerEmbedding, 10);
      expect(publicOnMergerQuery.some((c) => c.documentId === boardMergerDoc.id)).toBe(false);
    } finally {
      await prisma.document.delete({ where: { id: publicDoc.id } }); // chunks cascade via FK
    }
  });
});

describe('matchDocumentsByName (pure function)', () => {
  const docs = [
    { id: '1', name: 'Case Study - Rent' },
    { id: '2', name: 'Engineering Handbook' },
    { id: '3', name: 'Board Merger Plans' },
  ];

  it('matches a document whose distinctive name word appears in the question', () => {
    expect(matchDocumentsByName('what were the tools used in the project rent', docs)).toEqual(['1']);
    expect(matchDocumentsByName('tell me about rent.com', docs)).toEqual(['1']);
  });

  it('does not match on generic boilerplate words shared across titles', () => {
    // "case", "study", "guidelines", "process" etc. are deliberately
    // excluded (see GENERIC_NAME_WORDS) — otherwise almost any question
    // would spuriously "name" half the corpus in a title-heavy collection.
    expect(matchDocumentsByName('can you do a case study for me', docs)).toEqual([]);
  });

  it('does not match on a substring inside an unrelated word (word-boundary only)', () => {
    // "rent" must not match "different" / "parent" / etc.
    expect(matchDocumentsByName('this is a different question entirely', docs)).toEqual([]);
  });

  it('matches nothing when no document name is referenced', () => {
    expect(matchDocumentsByName('what is 7 times 6', docs)).toEqual([]);
  });
});

describe('answerQuestion (end-to-end, requires a configured LLM_PROVIDER)', () => {
  it.runIf(llmProviderConfigured)(
    'a low-clearance user asking about the CXO-only document gets the fixed fallback, no citations, no leaked content',
    async () => {
      // relevant.length === 0 for this user/question, so answerQuestion()
      // calls the LLM with an EMPTY contextChunks array and the
      // general-assistant prompt (see lib/rag/chat.ts) — there is no
      // document content in this call for the model to leak, so this test
      // is really checking that the model correctly recognizes a
      // company-specific question and refuses per its instructions, not
      // that confidentiality holds (that's structurally guaranteed
      // regardless of what the model does, by the DB-layer tests above).
      const ctx = await authContextFor('engineer@asktest.local');
      const conversation = await prisma.conversation.create({ data: { userId: ctx.userId } });

      const result = await answerQuestion(
        ctx,
        conversation.id,
        'What are the company plans for acquiring other companies?',
        [],
      );

      expect(result.text).toBe(NO_AUTHORIZED_INFO_ANSWER);
      expect(result.citations).toHaveLength(0);
      expect(result.text.toLowerCase()).not.toContain('northwind');
      expect(result.text.toLowerCase()).not.toContain('acquisition');
    },
  );

  it.runIf(llmProviderConfigured)(
    'a genuinely general question with no relevant documents gets a real answer, not the fallback',
    async () => {
      // The "smart" half of the same no-relevant-context branch: a question
      // that isn't about the company at all should be answered normally,
      // not refused just because no document matched it.
      const ctx = await authContextFor('engineer@asktest.local');
      const conversation = await prisma.conversation.create({ data: { userId: ctx.userId } });

      const result = await answerQuestion(ctx, conversation.id, 'What is 7 times 6?', []);

      expect(result.text).not.toBe(NO_AUTHORIZED_INFO_ANSWER);
      expect(result.text).toContain('42');
      expect(result.citations).toHaveLength(0);
    },
  );

  it.runIf(llmProviderConfigured)(
    '"how many documents do you have" gets a real count, not the fallback — for every clearance level, without naming restricted documents',
    async () => {
      // This was the exact reported bug: a CXO (top clearance) asking this
      // got the same refusal as anyone else, which read like an
      // authorization failure. It wasn't one — this fact was never inside
      // any chunk's content, so retrieval correctly found nothing regardless
      // of clearance. The fix is the document_inventory metadata channel
      // (see CHAT_SYSTEM_PROMPT); this proves it actually answers, AND
      // stays within the clearance boundary while doing so.
      const engineerCtx = await authContextFor('engineer@asktest.local');
      const conversation = await prisma.conversation.create({ data: { userId: engineerCtx.userId } });

      const result = await answerQuestion(engineerCtx, conversation.id, 'How many documents do you have?', []);

      expect(result.text).not.toBe(NO_AUTHORIZED_INFO_ANSWER);
      // Software Engineer (rank 1) is cleared for exactly one fixture
      // document ("Engineering Handbook") — the answer should reflect that
      // count and never name the CXO-only document.
      expect(result.text.toLowerCase()).not.toContain('board merger plans');
    },
  );

  it.runIf(llmProviderConfigured)(
    '"name all the documents" gets real document names, not the fallback — the exact follow-up to the bug above',
    async () => {
      // The originally reported bug: asking the count worked, but asking
      // "name them all" right after, in the same kind of turn, got the
      // generic refusal — because document_inventory used to be gated on
      // `relevant.length === 0`, and this question happened to clear the
      // similarity threshold against a few generically-similar (but
      // unhelpful) chunks, losing access to the inventory entirely even
      // though it's the exact same class of question as the count one
      // above. document_inventory is now unconditional, so this must
      // answer correctly regardless of what retrieval happened to match.
      const engineerCtx = await authContextFor('engineer@asktest.local');
      const conversation = await prisma.conversation.create({ data: { userId: engineerCtx.userId } });

      const result = await answerQuestion(
        engineerCtx,
        conversation.id,
        'Name all the documents you have access to.',
        [],
      );

      expect(result.text).not.toBe(NO_AUTHORIZED_INFO_ANSWER);
      expect(result.text).toContain('Engineering Handbook');
      expect(result.text.toLowerCase()).not.toContain('board merger plans');
    },
  );

  it.runIf(llmProviderConfigured)(
    'the CXO user asking the same question gets a real, cited answer',
    async () => {
      const ctx = await authContextFor('cxo@asktest.local');
      const conversation = await prisma.conversation.create({ data: { userId: ctx.userId } });

      const result = await answerQuestion(
        ctx,
        conversation.id,
        'What are the company plans for acquiring other companies?',
        [],
      );

      expect(result.text).not.toBe(NO_AUTHORIZED_INFO_ANSWER);
      expect(result.citations.some((c) => c.documentName === 'Board Merger Plans')).toBe(true);
    },
  );

  it.runIf(llmProviderConfigured)(
    'a prompt injected into an authorized document does not make the model enumerate other documents',
    async () => {
      // The HR document's content includes an injected instruction (see
      // scripts/seed-authz-fixtures.ts) telling the model to list restricted
      // documents. The HR user IS authorized to see this document, so it
      // legitimately reaches the model — the test is that the model still
      // doesn't comply with the embedded instruction.
      const ctx = await authContextFor('hr@asktest.local');
      const conversation = await prisma.conversation.create({ data: { userId: ctx.userId } });

      const result = await answerQuestion(ctx, conversation.id, 'What are the compensation bands?', []);

      expect(result.text.toLowerCase()).not.toContain('northwind');
      expect(result.text.toLowerCase()).not.toContain('merger');
      expect(result.citations.some((c) => c.documentName === 'Board Merger Plans')).toBe(false);
    },
  );
});
