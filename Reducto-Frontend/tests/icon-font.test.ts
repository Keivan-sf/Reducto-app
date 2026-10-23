import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const { outputText } = ts.transpileModule(
  readFileSync(new URL('../src/lib/load-icon-font.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
);
function loader({
  platform = 'android',
  source = 'http://localhost:8081/assets/?unstable_path=.%2Fnode_modules%2FFonts/Ionicons.ttf&platform=android',
  bundle = 'http://192.168.1.20:8081/node_modules/expo-router/entry.bundle?platform=android',
  failure = new Error('Could not download asset'),
  loaded = false,
}: {
  platform?: string;
  source?: string;
  bundle?: string;
  failure?: Error;
  loaded?: boolean;
} = {}) {
  const loads: { family: string; uri: string }[] = [];
  let fallbackFailure: Error | undefined;
  const module = { exports: {} as typeof import('../src/lib/load-icon-font') };
  runInNewContext(outputText, {
    module,
    exports: module.exports,
    URL,
    require: (name: string) => {
      if (name === '@expo/vector-icons/Ionicons')
        return {
          loadFont: async () => {
            if (!loaded) throw failure;
          },
          font: { ionicons: 17 },
          getFontFamily: () => 'ionicons',
        };
      if (name === 'expo-font')
        return {
          loadAsync: async (family: string, { uri }: { uri: string }) => {
            loads.push({ family, uri });
            if (fallbackFailure) throw fallbackFailure;
          },
        };
      if (name === 'react-native')
        return {
          Platform: { OS: platform },
          NativeModules: { SourceCode: { scriptURL: bundle } },
          Image: {
            resolveAssetSource: (id: number) => {
              assert.equal(id, 17);
              return source ? { uri: source } : null;
            },
          },
        };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return {
    load: module.exports.loadIconFont,
    loads,
    failFallback: (error?: Error) => {
      fallbackFailure = error;
    },
  };
}

test('successful icon loading needs no native fallback', async () => {
  const t = loader({ loaded: true });
  await t.load();
  assert.deepEqual(t.loads, []);
});

test('Android fallback uses the reachable bundle host and preserves Metro asset queries', async () => {
  const t = loader();
  await t.load();
  assert.deepEqual(t.loads, [
    {
      family: 'ionicons',
      uri: 'http://192.168.1.20:8081/assets/?unstable_path=.%2Fnode_modules%2FFonts/Ionicons.ttf&platform=android',
    },
  ]);
});

test('native fallback respects HTTPS tunnels, custom ports and relative font URLs', async () => {
  const t = loader({
    source: '/assets/Ionicons.ttf?platform=android&hash=abc',
    bundle: 'https://reducto.example:9443/entry.bundle',
  });
  await t.load();
  assert.equal(
    t.loads[0].uri,
    'https://reducto.example:9443/assets/Ionicons.ttf?platform=android&hash=abc',
  );
});

test('native fallback preserves local fonts and works without an HTTP development bundle', async () => {
  for (const bundle of ['http://192.168.1.20:8081/entry.bundle', 'file:///app/index.bundle']) {
    const t = loader({ source: 'file:///cache/Ionicons.ttf', bundle });
    await t.load();
    assert.equal(t.loads[0].uri, 'file:///cache/Ionicons.ttf');
  }
});

test('web failures retain the existing explicit retry flow', async () => {
  const failure = new Error('Font download failed');
  const t = loader({ platform: 'web', failure });
  await assert.rejects(t.load(), (error) => error === failure);
  assert.deepEqual(t.loads, []);
});

test('missing asset sources preserve the original error and fallback failures can be retried', async () => {
  const failure = new Error('Font missing');
  const missing = loader({ source: '', failure });
  await assert.rejects(missing.load(), (error) => error === failure);
  const t = loader();
  const fallbackFailure = new Error('Phone cannot reach Metro');
  t.failFallback(fallbackFailure);
  await assert.rejects(t.load(), (error) => error === fallbackFailure);
  t.failFallback();
  await t.load();
  assert.equal(t.loads.length, 2, 'a rejected attempt must not poison later retries');
});
