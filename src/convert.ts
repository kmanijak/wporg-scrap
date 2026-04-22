import TurndownService from 'turndown';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  emDelimiter: '_',
});

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html).trim();
}
