export interface ToolTextContent {
  type: 'text';
  text: string;
}

export interface ToolResult<TDetails = unknown> {
  content?: ToolTextContent[];
  details?: TDetails;
}

export function extractText(result: ToolResult): string {
  return result.content?.find((item) => item.type === 'text')?.text ?? '';
}

export function extractDetails<TDetails>(result: ToolResult<TDetails>): TDetails | undefined {
  return result.details;
}
