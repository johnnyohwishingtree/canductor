/**
 * Policy expression parser — evaluates boolean expressions from config.yaml
 * policy strings against a PolicyContext derived from layer results.
 *
 * Supports:
 *   - Boolean context values: all_deterministic_pass, any_deterministic_fail, etc.
 *   - Comparisons: composite_score >= 80, composite_score >= baseline
 *   - Layer access: ux_review.pass, visual.score > 90, ux_review.has_issues
 *   - Logical operators: AND, OR, NOT (case-insensitive, AND binds tighter)
 *   - Parentheses for grouping
 */

import type { CanductorConfig, LayerResult } from './types.js';

/** Context available to policy expressions. */
export interface PolicyContext {
  all_deterministic_pass: boolean;
  any_deterministic_fail: boolean;
  all_pass: boolean;
  any_agent_review_fail: boolean;
  composite_score: number;
  baseline: number;
  layers: Record<string, { pass: boolean; score: number; has_issues: boolean }>;
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type TokenType =
  | 'IDENT'     // variable name or layer.field
  | 'NUMBER'    // numeric literal
  | 'OP'        // comparison operator: >=, <=, >, <, ==, !=
  | 'AND'
  | 'OR'
  | 'NOT'
  | 'LPAREN'
  | 'RPAREN';

interface Token {
  type: TokenType;
  value: string;
}

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    // Skip whitespace
    if (/\s/.test(expr[i])) {
      i++;
      continue;
    }

    // Parentheses
    if (expr[i] === '(') {
      tokens.push({ type: 'LPAREN', value: '(' });
      i++;
      continue;
    }
    if (expr[i] === ')') {
      tokens.push({ type: 'RPAREN', value: ')' });
      i++;
      continue;
    }

    // Comparison operators (must check two-char ops first)
    if (expr[i] === '>' && expr[i + 1] === '=') {
      tokens.push({ type: 'OP', value: '>=' });
      i += 2;
      continue;
    }
    if (expr[i] === '<' && expr[i + 1] === '=') {
      tokens.push({ type: 'OP', value: '<=' });
      i += 2;
      continue;
    }
    if (expr[i] === '=' && expr[i + 1] === '=') {
      tokens.push({ type: 'OP', value: '==' });
      i += 2;
      continue;
    }
    if (expr[i] === '!' && expr[i + 1] === '=') {
      tokens.push({ type: 'OP', value: '!=' });
      i += 2;
      continue;
    }
    if (expr[i] === '>') {
      tokens.push({ type: 'OP', value: '>' });
      i++;
      continue;
    }
    if (expr[i] === '<') {
      tokens.push({ type: 'OP', value: '<' });
      i++;
      continue;
    }

    // Numbers (including negative)
    if (/\d/.test(expr[i]) || (expr[i] === '-' && i + 1 < expr.length && /\d/.test(expr[i + 1]))) {
      let num = '';
      if (expr[i] === '-') {
        num += '-';
        i++;
      }
      while (i < expr.length && /[\d.]/.test(expr[i])) {
        num += expr[i];
        i++;
      }
      tokens.push({ type: 'NUMBER', value: num });
      continue;
    }

    // Identifiers: letters, digits, underscores, dots (for layer.field access)
    if (/[a-zA-Z_]/.test(expr[i])) {
      let ident = '';
      while (i < expr.length && /[a-zA-Z0-9_.]/.test(expr[i])) {
        ident += expr[i];
        i++;
      }
      // Check for keywords (case-insensitive)
      const upper = ident.toUpperCase();
      if (upper === 'AND') {
        tokens.push({ type: 'AND', value: 'AND' });
      } else if (upper === 'OR') {
        tokens.push({ type: 'OR', value: 'OR' });
      } else if (upper === 'NOT') {
        tokens.push({ type: 'NOT', value: 'NOT' });
      } else {
        tokens.push({ type: 'IDENT', value: ident });
      }
      continue;
    }

    throw new Error(`Unexpected character '${expr[i]}' at position ${i} in expression: ${expr}`);
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Value resolution
// ---------------------------------------------------------------------------

/** Resolve an identifier to its value from the context. */
function resolveValue(ident: string, context: PolicyContext): boolean | number {
  // Direct boolean fields
  if (ident in context && typeof (context as unknown as Record<string, unknown>)[ident] !== 'object') {
    return (context as unknown as Record<string, boolean | number>)[ident];
  }

  // Layer access: layer_name.field
  const dotIndex = ident.indexOf('.');
  if (dotIndex !== -1) {
    const layerName = ident.substring(0, dotIndex);
    const field = ident.substring(dotIndex + 1);
    const layer = context.layers[layerName];
    if (!layer) {
      throw new Error(`Unknown layer '${layerName}' in expression`);
    }
    if (!(field in layer)) {
      throw new Error(`Unknown field '${field}' on layer '${layerName}'`);
    }
    return (layer as Record<string, boolean | number>)[field];
  }

  throw new Error(`Unknown identifier '${ident}' in policy expression`);
}

// ---------------------------------------------------------------------------
// Recursive descent parser
// ---------------------------------------------------------------------------

/**
 * Grammar (AND binds tighter than OR):
 *
 *   expr     → or_expr
 *   or_expr  → and_expr ( OR and_expr )*
 *   and_expr → not_expr ( AND not_expr )*
 *   not_expr → NOT not_expr | primary
 *   primary  → '(' expr ')' | comparison | boolean_ident
 *   comparison → ident OP (number | ident)
 *   boolean_ident → ident  (resolves to boolean)
 */
class Parser {
  private tokens: Token[];
  private pos: number;
  private context: PolicyContext;

  constructor(tokens: Token[], context: PolicyContext) {
    this.tokens = tokens;
    this.pos = 0;
    this.context = context;
  }

  parse(): boolean {
    const result = this.parseOr();
    if (this.pos < this.tokens.length) {
      throw new Error(
        `Unexpected token '${this.tokens[this.pos].value}' at position ${this.pos}`
      );
    }
    return result;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private advance(): Token {
    const t = this.tokens[this.pos];
    this.pos++;
    return t;
  }

  private parseOr(): boolean {
    let left = this.parseAnd();
    while (this.peek()?.type === 'OR') {
      this.advance(); // consume OR
      const right = this.parseAnd();
      left = left || right;
    }
    return left;
  }

  private parseAnd(): boolean {
    let left = this.parseNot();
    while (this.peek()?.type === 'AND') {
      this.advance(); // consume AND
      const right = this.parseNot();
      left = left && right;
    }
    return left;
  }

  private parseNot(): boolean {
    if (this.peek()?.type === 'NOT') {
      this.advance(); // consume NOT
      return !this.parseNot();
    }
    return this.parsePrimary();
  }

  private parsePrimary(): boolean {
    const token = this.peek();
    if (!token) {
      throw new Error('Unexpected end of expression');
    }

    // Parenthesized expression
    if (token.type === 'LPAREN') {
      this.advance(); // consume (
      const result = this.parseOr();
      const closing = this.peek();
      if (!closing || closing.type !== 'RPAREN') {
        throw new Error('Expected closing parenthesis');
      }
      this.advance(); // consume )
      return result;
    }

    // Identifier — could be a comparison or a standalone boolean
    if (token.type === 'IDENT') {
      const ident = this.advance();
      const next = this.peek();

      // Check if this is a comparison (ident OP value)
      if (next?.type === 'OP') {
        const op = this.advance();
        const rightToken = this.peek();
        if (!rightToken) {
          throw new Error(`Expected value after '${op.value}'`);
        }

        let rightValue: number;
        if (rightToken.type === 'NUMBER') {
          rightValue = parseFloat(this.advance().value);
        } else if (rightToken.type === 'IDENT') {
          const resolved = resolveValue(this.advance().value, this.context);
          if (typeof resolved !== 'number') {
            throw new Error(
              `Right side of comparison '${rightToken.value}' must be numeric`
            );
          }
          rightValue = resolved;
        } else {
          throw new Error(`Expected number or identifier after '${op.value}'`);
        }

        const leftValue = resolveValue(ident.value, this.context);
        if (typeof leftValue !== 'number') {
          throw new Error(
            `Left side of comparison '${ident.value}' must be numeric`
          );
        }

        return evalComparison(leftValue, op.value, rightValue);
      }

      // Standalone boolean identifier
      const value = resolveValue(ident.value, this.context);
      if (typeof value === 'boolean') {
        return value;
      }
      // A numeric value used as boolean: truthy check
      return value !== 0;
    }

    throw new Error(`Unexpected token '${token.value}' (${token.type})`);
  }
}

function evalComparison(left: number, op: string, right: number): boolean {
  switch (op) {
    case '>=': return left >= right;
    case '<=': return left <= right;
    case '>':  return left > right;
    case '<':  return left < right;
    case '==': return left === right;
    case '!=': return left !== right;
    default:
      throw new Error(`Unknown comparison operator: ${op}`);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Evaluate a single policy expression string against a context. */
export function evaluateExpression(expr: string, context: PolicyContext): boolean {
  const tokens = tokenize(expr.trim());
  if (tokens.length === 0) return false;
  const parser = new Parser(tokens, context);
  return parser.parse();
}

/**
 * Build a PolicyContext from layer results, composite score, and baseline.
 */
export function buildPolicyContext(
  results: LayerResult[],
  compositeScore: number,
  baseline: number
): PolicyContext {
  const deterministicTypes: string[] = ['deterministic', 'guardrail'];

  const allDeterministicPass = results
    .filter(r => deterministicTypes.includes(r.type))
    .every(r => r.pass);

  const anyDeterministicFail = results
    .some(r => deterministicTypes.includes(r.type) && !r.pass);

  const allPass = results.every(r => r.pass);

  const anyAgentReviewFail = results
    .some(r => r.type === 'agent-review' && !r.pass);

  const layers: PolicyContext['layers'] = {};
  for (const r of results) {
    layers[r.name] = {
      pass: r.pass,
      score: r.score,
      has_issues: !r.pass || r.errors.length > 0,
    };
  }

  return {
    all_deterministic_pass: allDeterministicPass,
    any_deterministic_fail: anyDeterministicFail,
    all_pass: allPass,
    any_agent_review_fail: anyAgentReviewFail,
    composite_score: compositeScore,
    baseline,
    layers,
  };
}

/**
 * Evaluate all policy rules in priority order:
 *   1. block (if true → 'block')
 *   2. auto_merge (if true → 'auto_merge')
 *   3. fallback → 'human_review'
 */
export function evaluateAllPolicies(
  config: CanductorConfig,
  context: PolicyContext
): 'auto_merge' | 'human_review' | 'block' {
  // Block takes priority
  if (evaluateExpression(config.policy.block, context)) {
    return 'block';
  }

  // Then auto-merge
  if (evaluateExpression(config.policy.auto_merge, context)) {
    return 'auto_merge';
  }

  // Fallback: human review
  return 'human_review';
}
