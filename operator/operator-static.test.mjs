import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const script=await readFile(new URL('./Tablekeeper.Operator.ps1',import.meta.url),'utf8');
const menu=await readFile(new URL('../TABLEKEEPER.cmd',import.meta.url),'utf8');

test('start verifies but never migrates, seeds, drops, or deletes bookings',()=>{
  const body=script.match(/function Start-App\{([\s\S]*?)\n\}/)?.[1]??'';
  assert.match(body,/Assert-Canonical/);
  assert.doesNotMatch(body,/Reset-Demo|DROP DATABASE|\bseed\b|\bmigrate\b|DELETE FROM|TRUNCATE/i);
});

test('stop targets only launcher-recorded process trees after ownership validation',()=>{
  assert.match(script,/function Owned-Process/);
  assert.match(script,/if\(Owned-Process \$entry\).*taskkill\.exe \/PID \$entry\.pid \/T \/F/s);
  assert.doesNotMatch(script,/Stop-Service|postgresql-x64|taskkill\.exe \/IM|Get-Process node.*Stop-Process/s);
});

test('reset is guarded and uses authoritative migration and seed artifacts',()=>{
  assert.match(script,/expectedDatabase/);
  assert.match(script,/postgres','template0','template1','tablekeeper_integration/);
  assert.match(script,/Type RESET/);
  assert.match(script,/reservation-core\\migrations/);
  assert.match(script,/tablekeeper-platform\.seed-descriptor\.json/);
  assert.doesNotMatch(script,/DELETE FROM|TRUNCATE/i);
});

test('reset verifies canonical catalog and empty transactional state',()=>{
  assert.match(script,/24\\\|97\\\|97\\\|24\\\|158/);
  assert.match(script,/0004_venue_service_hours/);
  assert.match(script,/Assert-ResetClean/);
  assert.match(script,/\^0\\\|0\\\|0\\\|0\\\|0\\\|0\\\|0\\\|0\$/);
});

test('menu and wrappers are independent of launch working directory and do not echo secrets',()=>{
  assert.match(menu,/cd \/d "%~dp0"/);
  assert.match(menu,/Reset Demo \^& Start/);
  assert.doesNotMatch(script,/Write-Host .*DatabaseUrl|Write-Output .*DatabaseUrl/);
});
