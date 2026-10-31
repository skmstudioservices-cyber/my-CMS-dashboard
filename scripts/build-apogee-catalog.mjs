import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const source = resolve('node_modules/@ava-ui/apogee/registry/index.json');
const target = resolve('public/apogee-catalog.json');
const registry = JSON.parse(readFileSync(source, 'utf8'));
const items = Object.entries(registry.components).map(([name, item]) => ({
  name, kind: item.kind || 'component', category: item.category || 'general',
  title: item.title || name, description: item.description || '',
  files: item.files || [], dependencies: item.dependencies || [],
  usesJs: Boolean(item.usesJs), registryDependencies: item.registryDependencies || []
})).sort((a,b) => a.kind.localeCompare(b.kind) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
mkdirSync(resolve('public'), { recursive: true });
writeFileSync(target, JSON.stringify({ version: '0.11.0', license: 'MIT', items }, null, 2));
console.log('Apogee catalog generated:', items.length, 'items');
