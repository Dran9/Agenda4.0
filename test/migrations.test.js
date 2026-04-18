const { test } = require('node:test');
const assert = require('node:assert/strict');
const { splitStatements } = require('../server/migrations');

test('splitStatements: splits on semicolons', () => {
  const sql = 'CREATE TABLE a (id INT); CREATE TABLE b (id INT);';
  assert.deepEqual(splitStatements(sql), ['CREATE TABLE a (id INT)', 'CREATE TABLE b (id INT)']);
});

test('splitStatements: trailing statement without semicolon', () => {
  const sql = 'CREATE TABLE a (id INT); CREATE TABLE b (id INT)';
  assert.deepEqual(splitStatements(sql), ['CREATE TABLE a (id INT)', 'CREATE TABLE b (id INT)']);
});

test('splitStatements: ignores semicolons inside single quotes', () => {
  const sql = "INSERT INTO t VALUES ('a;b'); INSERT INTO t VALUES ('c;d');";
  assert.deepEqual(splitStatements(sql), [
    "INSERT INTO t VALUES ('a;b')",
    "INSERT INTO t VALUES ('c;d')",
  ]);
});

test('splitStatements: ignores semicolons inside double quotes', () => {
  const sql = 'INSERT INTO t VALUES ("a;b"); SELECT 1;';
  assert.deepEqual(splitStatements(sql), ['INSERT INTO t VALUES ("a;b")', 'SELECT 1']);
});

test('splitStatements: ignores semicolons inside backticks', () => {
  const sql = 'CREATE TABLE `weird;name` (id INT); SELECT 1;';
  assert.deepEqual(splitStatements(sql), ['CREATE TABLE `weird;name` (id INT)', 'SELECT 1']);
});

test('splitStatements: ignores line comments', () => {
  const sql = `
    -- a comment with ; semicolon
    SELECT 1;
    -- another
    SELECT 2;
  `;
  const stmts = splitStatements(sql);
  assert.equal(stmts.length, 2);
  assert.match(stmts[0], /SELECT 1/);
  assert.match(stmts[1], /SELECT 2/);
});

test('splitStatements: ignores block comments', () => {
  const sql = '/* header; with semicolon */ SELECT 1; /* trailing */';
  const stmts = splitStatements(sql);
  assert.equal(stmts.length, 1);
  assert.match(stmts[0], /SELECT 1/);
});

test('splitStatements: empty input returns empty array', () => {
  assert.deepEqual(splitStatements(''), []);
  assert.deepEqual(splitStatements('   '), []);
  assert.deepEqual(splitStatements(';;;'), []);
});

test('splitStatements: handles realistic migration content', () => {
  const sql = `
    -- Migration 002: add client email
    ALTER TABLE clients ADD COLUMN email VARCHAR(255) DEFAULT NULL;
    CREATE INDEX idx_clients_email ON clients(email);
  `;
  const stmts = splitStatements(sql);
  assert.equal(stmts.length, 2);
  assert.match(stmts[0], /ALTER TABLE clients ADD COLUMN email/);
  assert.match(stmts[1], /CREATE INDEX idx_clients_email/);
});
