import dotenv from 'dotenv';

dotenv.config({ quiet: true });

// Route every DB call in the test run at the disposable test database, never
// the dev database seeded with real-looking data — see .env.example.
if (process.env.DATABASE_URL_TEST) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
}
