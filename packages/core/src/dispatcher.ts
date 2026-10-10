/**
 * Button function dispatcher. A layout button carries one or more (functionNo, args) pairs,
 * exactly like the L-POS FUNCTIONS table (F2014 function number, F2015 arguments such as
 * "/MAX=1000.00 /CHG=100.00" or "/TOG /SWP=+6").
 */
export type FunctionArgs = Record<string, string | true>;

/** Parse "/MAX=1000.00 /CHG=100.00 /DEF" -> { MAX: '1000.00', CHG: '100.00', DEF: true }. Keys are upper-cased. */
export function parseArgs(args: string): FunctionArgs {
  const out: FunctionArgs = {};
  for (const token of args.split(/\s+(?=\/)/)) {
    const t = token.trim();
    if (!t.startsWith('/')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) out[t.slice(1).toUpperCase()] = true;
    else out[t.slice(1, eq).toUpperCase()] = t.slice(eq + 1);
  }
  return out;
}

export interface FunctionContext { input: string }
export type FunctionHandler = (ctx: FunctionContext, args: FunctionArgs) => Promise<void> | void;

export class Dispatcher {
  private handlers = new Map<number, FunctionHandler>();
  register(functionNo: number, handler: FunctionHandler): this { this.handlers.set(functionNo, handler); return this; }
  has(functionNo: number): boolean { return this.handlers.has(functionNo); }
  /** Runs the functions of a button in sequence; an unknown function stops the chain with an error. */
  async run(ctx: FunctionContext, functions: { seq: number; functionNo: number; args: string }[]): Promise<void> {
    for (const f of [...functions].sort((a, b) => a.seq - b.seq)) {
      const h = this.handlers.get(f.functionNo);
      if (!h) throw new Error(`FUNCTION_NOT_IMPLEMENTED:${f.functionNo}`);
      await h(ctx, parseArgs(f.args));
    }
  }
}
