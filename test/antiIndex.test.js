const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('robots.txt: bloquea a todos los rastreadores en la raíz', () => {
  const robotsPath = path.resolve(__dirname, '../public/robots.txt');
  assert.ok(fs.existsSync(robotsPath), 'robots.txt debe existir en public/');
  const content = fs.readFileSync(robotsPath, 'utf8');
  assert.match(content, /User-agent:\s*\*/i);
  assert.match(content, /Disallow:\s*\//i);
});

test('meta tags: index.html y admin tienen etiquetas noindex y nofollow', () => {
  const htmlFiles = [
    path.resolve(__dirname, '../public/index.html'),
    path.resolve(__dirname, '../public/admin/index.html'),
    path.resolve(__dirname, '../public/admin/login.html')
  ];

  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, 'utf8');
    assert.match(html, /<meta\s+name=["']robots["']\s+content=["'][^"']*noindex/i, `${path.basename(file)} debe tener meta robots noindex`);
    assert.match(html, /<meta\s+name=["']googlebot["']\s+content=["'][^"']*noindex/i, `${path.basename(file)} debe tener meta googlebot noindex`);
  }
});

test('server.js: incluye middleware con cabecera X-Robots-Tag global', () => {
  const serverPath = path.resolve(__dirname, '../server.js');
  const code = fs.readFileSync(serverPath, 'utf8');
  assert.match(code, /X-Robots-Tag/i);
  assert.match(code, /noindex/i);
  assert.match(code, /nofollow/i);
});
