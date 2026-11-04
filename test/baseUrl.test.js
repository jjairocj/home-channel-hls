const test = require('node:test');
const assert = require('node:assert');
const { getBaseUrl, isPrivateHost } = require('../core/url');

test('isPrivateHost: detecta hosts y rangos IP privados correctamente', () => {
  assert.strictEqual(isPrivateHost('localhost'), true);
  assert.strictEqual(isPrivateHost('localhost:3000'), true);
  assert.strictEqual(isPrivateHost('127.0.0.1:3600'), true);
  assert.strictEqual(isPrivateHost('192.168.68.201:3600'), true);
  assert.strictEqual(isPrivateHost('192.168.1.50'), true);
  assert.strictEqual(isPrivateHost('10.0.0.2:8080'), true);
  assert.strictEqual(isPrivateHost('172.16.0.10:3000'), true);
  assert.strictEqual(isPrivateHost('casaos.local:3600'), true);

  // Hosts públicos deben dar false
  assert.strictEqual(isPrivateHost('crhe.jairocruz.dev'), false);
  assert.strictEqual(isPrivateHost('crhe.jairocruz.dev:443'), false);
  assert.strictEqual(isPrivateHost('google.com'), false);
  assert.strictEqual(isPrivateHost('8.8.8.8'), false);
});

test('getBaseUrl: peticiones desde IP/LAN local usan IP y puerto local', () => {
  const origEnv = process.env.PUBLIC_BASE_URL;
  process.env.PUBLIC_BASE_URL = 'https://crhe.jairocruz.dev';

  try {
    // Caso 1: TV o dispositivo en la misma red local usando la IP de CasaOS
    const reqLocal = {
      headers: { host: '192.168.68.201:3600' }
    };
    assert.strictEqual(getBaseUrl(reqLocal), 'http://192.168.68.201:3600');

    // Caso 2: Dispositivo usando otro puerto local o localhost
    const reqLocalhost = {
      headers: { host: 'localhost:3000' }
    };
    assert.strictEqual(getBaseUrl(reqLocalhost), 'http://localhost:3000');

    // Caso 3: Dispositivo con X-Forwarded-Host en red local
    const reqForwardedLocal = {
      headers: {
        host: '127.0.0.1:3000',
        'x-forwarded-host': '192.168.68.201:3600'
      }
    };
    assert.strictEqual(getBaseUrl(reqForwardedLocal), 'http://192.168.68.201:3600');

    // Caso 4: Petición desde el dominio público por Cloudflare
    const reqPublic = {
      headers: { host: 'crhe.jairocruz.dev' }
    };
    assert.strictEqual(getBaseUrl(reqPublic), 'https://crhe.jairocruz.dev');

    // Caso 5: Petición externa vía proxy con X-Forwarded-Host
    const reqProxyPublic = {
      headers: {
        host: '127.0.0.1:3000',
        'x-forwarded-host': 'crhe.jairocruz.dev',
        'x-forwarded-proto': 'https'
      }
    };
    assert.strictEqual(getBaseUrl(reqProxyPublic), 'https://crhe.jairocruz.dev');

    // Caso 6: Sin req (llamada background interna)
    assert.strictEqual(getBaseUrl(), 'https://crhe.jairocruz.dev');
  } finally {
    process.env.PUBLIC_BASE_URL = origEnv;
  }
});
