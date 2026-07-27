/* eslint-disable camelcase */

// Local-dev only: drives the mock signal generator (src/lib/mockCollector.ts)
// so different seeded customers demo different SLA outcomes (compliant,
// at-risk, breached, data-incomplete) without needing real AWS accounts.
// Not part of the spec's schema -- this column has no meaning outside the
// mock collector and would not exist in a real-AWS deployment.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE customers
      ADD COLUMN demo_profile VARCHAR(20) NOT NULL DEFAULT 'stable';
  `);
  pgm.sql(`
    ALTER TABLE customers
      ADD CONSTRAINT demo_profile_check
      CHECK (demo_profile IN ('stable', 'flaky', 'degrading', 'breached', 'data_gap'));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE customers DROP COLUMN IF EXISTS demo_profile;`);
};
