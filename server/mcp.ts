// Daily Bouquet - an MCP server (stdio) so any model that speaks MCP can put flowers in the vase: Claude Desktop,
// Claude Code, or your own agent. It writes to the same DATA_DIR as the HTTP server, so the page shows what it arranges.
//
//   tools: arrange  - put today's bouquet in the vase, with a note
//          recent   - the last few days' bouquets (so it does not send the same every day)
//          catalog  - every flower and its colours
//          today    - a few lines for the model's context: today's bouquet, or that there is none yet
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { FLOWER_KINDS } from '../src/vase/flowerCatalog.ts';
import { ARRANGE_HELP, arrangeBouquet, catalogText, describeStems, recentBouquets, vasePrompt } from './store.ts';

const text = (value: string, isError = false) => ({ content: [{ type: 'text' as const, text: value }], ...(isError ? { isError: true } : {}) });
const server = new McpServer({ name: 'daily-bouquet', version: '0.1.0' });

server.registerTool('arrange', {
  description: `${ARRANGE_HELP}\n\nFlowers:\n${catalogText()}`,
  inputSchema: {
    stems: z.array(z.object({
      kind: z.enum(FLOWER_KINDS), color: z.string().optional(), count: z.number().int().min(1).max(7).optional(),
      shape: z.object({
        bend: z.number().optional(), headSize: z.number().optional(), petalWidth: z.number().optional(), open: z.number().optional(),
        leafSize: z.number().optional(), leafWidth: z.number().optional(), stemWidth: z.number().optional(),
      }).optional(),
    })).min(1).max(6),
    note: z.string().min(1).max(140),
    title: z.string().max(16).optional(),
  },
}, async (input) => {
  try {
    const b = arrangeBouquet(input);
    return text(`Arranged: ${describeStems(b.stems)}${b.title ? ` "${b.title}"` : ''}. The user will see it on the vase page.`);
  } catch (error) {
    return text(error instanceof Error ? error.message : String(error), true);
  }
});

server.registerTool('recent', {
  description: 'The bouquets of the last few days, so you do not send the same every day.',
  inputSchema: { days: z.number().int().min(1).max(30).optional() },
  annotations: { readOnlyHint: true },
}, async ({ days }) => {
  const list = recentBouquets(days ?? 7);
  return text(list.length ? list.map((b) => `${b.date}: ${describeStems(b.stems)}${b.title ? ` "${b.title}"` : ''} - ${b.note}`).join('\n') : 'No bouquets yet.');
});

server.registerTool('catalog', { description: 'Every flower you can choose, its colours and what it is like.', annotations: { readOnlyHint: true } }, async () => text(catalogText()));
server.registerTool('today', { description: "Today's bouquet, or that there is none yet (and whether the user arranged a vase of her own today).", annotations: { readOnlyHint: true } }, async () => text(vasePrompt()));

await server.connect(new StdioServerTransport());
