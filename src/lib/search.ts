export function stripAccents(text: string) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function matchesSearch(name: string, query: string) {
  return stripAccents(name).toLowerCase().includes(stripAccents(query).toLowerCase());
}
