import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('src/App.vue', 'utf8');
const styles = readFileSync('src/styles/main.css', 'utf8');

describe('unified login responsive layout', () => {
  it('exposes the current auth view to responsive styles', () => {
    assert.match(app, /\['login-panel', `view-\$\{currentView\}`\]/);
  });

  it('uses a scrollable, naturally positioned mobile form', () => {
    assert.match(styles, /@media \(max-width: 768px\)[\s\S]*\.login-landing \{[\s\S]*overflow-y: auto/);
    assert.match(styles, /\.form-box, \.form-box\.slide-register \{[\s\S]*position: relative;[\s\S]*transform: none;/);
    assert.match(styles, /\.login-panel\.view-register \.con-box\.right/);
  });
});
