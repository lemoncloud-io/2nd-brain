// 공개 API 재수출. 바깥(loader·cli·UI)은 이 파일만 본다.
export * from './types.ts';
export { splitFrontmatter } from './frontmatter.ts';
export type { SplitResult } from './frontmatter.ts';
export { extractHeadings, slugify } from './slug.ts';
export { resolveRef } from './resolve.ts';
export type { RefShape, ResolveResult } from './resolve.ts';
export { ModelError, formatPath, parseLedger, parseViewer } from './parse.ts';
export { evaluateStatus, matchDefault } from './rules.ts';
export type { EvaluateInput, EvaluateOutput, LedgerRefResolver, StageSpec } from './rules.ts';
export { checkProject, isUnsafePath } from './check.ts';
export type { CheckInput } from './check.ts';
export { checkFidelity, collectExplanations, normalizeForFidelity, numberContexts, splitSentences } from './fidelity.ts';
export type { Explanation, FidelityInput, FidelityResult, NumberContext } from './fidelity.ts';
