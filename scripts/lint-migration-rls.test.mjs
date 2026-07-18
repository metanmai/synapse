import assert from "node:assert/strict";
import test from "node:test";
import { auditMigrationSql } from "./lint-migration-rls.mjs";

test("accepts RLS enabled in a later migration", () => {
  const result = auditMigrationSql([
    { name: "001.sql", sql: "create table public.projects (id uuid primary key);" },
    { name: "002.sql", sql: "alter table public.projects enable row level security;" },
  ]);

  assert.equal(result.publicTableCount, 1);
  assert.deepEqual(result.missingRls, []);
});

test("reports a public table whose migration chain never enables RLS", () => {
  const result = auditMigrationSql([{ name: "001.sql", sql: "CREATE TABLE audit_log (id bigint);" }]);

  assert.deepEqual(result.missingRls, [{ table: "audit_log", createdIn: "001.sql", rlsEnabled: false }]);
});

test("treats a later RLS disable as unprotected", () => {
  const result = auditMigrationSql([
    {
      name: "001.sql",
      sql: `
        create table "SensitiveData" (id bigint);
        alter table "SensitiveData" enable row level security;
        alter table "SensitiveData" disable row level security;
      `,
    },
  ]);

  assert.equal(result.missingRls[0]?.table, "SensitiveData");
});

test("ignores temporary, non-public, commented, string, and function-body table text", () => {
  const result = auditMigrationSql([
    {
      name: "001.sql",
      sql: `
        -- create table fake_comment (id bigint);
        create temporary table scratch (id bigint);
        create table auth.identities_shadow (id bigint);
        select 'create table fake_string (id bigint)';
        create function public.fake() returns void language plpgsql as $$
        begin
          execute 'create table fake_dynamic (id bigint)';
        end;
        $$;
      `,
    },
  ]);

  assert.equal(result.publicTableCount, 0);
  assert.deepEqual(result.missingRls, []);
});

test("does not require RLS for a public table dropped later in the chain", () => {
  const result = auditMigrationSql([
    { name: "001.sql", sql: "create table obsolete (id bigint);" },
    { name: "002.sql", sql: "drop table if exists public.obsolete cascade;" },
  ]);

  assert.equal(result.publicTableCount, 0);
  assert.deepEqual(result.missingRls, []);
});
