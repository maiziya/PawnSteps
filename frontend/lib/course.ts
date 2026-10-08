import type { CourseItem } from '@/lib/types';

export interface CourseGroup {
  id: string;
  name: string;
  indices: number[];
}

const naturalOrder = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

export function normalizeCourseItemName(name: string): string {
  const value = name.trim();
  if (value.endsWith('/')) return value;
  const separator = value.lastIndexOf('|');
  if (separator < 0 || !/^\d+$/.test(value.slice(separator + 1).trim())) return value;
  const title = value.slice(0, separator).trimEnd();
  // An escaped pipe is literal title text, not an exported numeric suffix.
  return title && !title.endsWith('\\') ? title : value;
}

export function displayCourseItemName(name: string): string {
  return normalizeCourseItemName(name).replace(/\\\|/g, '|');
}

export function parseCourseText(text: string): CourseItem[] {
  const items: CourseItem[] = [];
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const heading = line.match(/^\s*###\s+(.+?)\s*#*\s*$/);
    if (heading) {
      items.push({ name: `${heading[1].replace(/\/+$/, '')}/`, done: false });
      continue;
    }
    const item = line.match(/^\s*[-*]\s+(?:\[[ xX]\]\s*)?(.+?)\s*$/);
    if (item) items.push({ name: normalizeCourseItemName(item[1]), done: false });
  }
  return items;
}

export function parseCourseDirectory(source: FileList | File[]): CourseItem[] {
  const files = Array.from(source).filter(file => !file.name.startsWith('.'));
  files.sort((left, right) => naturalOrder.compare(left.webkitRelativePath || left.name, right.webkitRelativePath || right.name));
  const items: CourseItem[] = [];
  let previousFolder = '';
  for (const file of files) {
    const path = (file.webkitRelativePath || file.name).split('/');
    if (path.length > 1) path.shift();
    if (path.some(part => part.startsWith('.'))) continue;
    const filename = path.pop() || file.name;
    const folder = path.join('/');
    if (folder !== previousFolder && folder) {
      items.push({ name: `${folder}/`, done: false });
    }
    if (!folder && previousFolder) items.push({ name: '根目录/', done: false });
    previousFolder = folder;
    const name = filename.replace(/\.[^.]+$/, '') || filename;
    items.push({ name: normalizeCourseItemName(name), done: false });
  }
  return items;
}

export function groupCourseItems(items: CourseItem[]): CourseGroup[] {
  if (!items.some(item => item.name.endsWith('/'))) {
    const groups: CourseGroup[] = [];
    for (let index = 0; index < items.length; index += 25) {
      groups.push({
        id: `batch-${index}`,
        name: `第 ${Math.floor(index / 25) + 1} 组`,
        indices: Array.from({ length: Math.min(25, items.length - index) }, (_, offset) => index + offset),
      });
    }
    return groups;
  }
  const groups: CourseGroup[] = [];
  let current: CourseGroup = { id: 'root', name: '课程内容', indices: [] };
  for (const [index, item] of items.entries()) {
    if (item.name.endsWith('/')) {
      if (current.indices.length) groups.push(current);
      current = { id: `folder-${index}`, name: item.name.slice(0, -1), indices: [] };
    } else {
      current.indices.push(index);
    }
  }
  if (current.indices.length) groups.push(current);
  return groups;
}
