// git 을 spawn 하는 얇은 래퍼. 쉘을 거치지 않고 인자를 배열로 넘기므로 한글·공백 경로가 그대로 간다.
// 예외를 던지지 않는다 — 실패(종료 코드·시간 초과·git 없음·NUL 이 든 인자)는 ok:false 와 stderr 로 돌려준다.
import { spawn, spawnSync, type SpawnSyncReturns } from 'node:child_process';

export type GitResult = { ok: boolean; stdout: string; stderr: string };
export type GitOptions = { timeoutMs?: number; input?: string };

export const GIT_TIMEOUT_MS = 15_000;
const MAX_BUFFER = 64 * 1024 * 1024;

// 자격 증명 프롬프트로 멈추지 않게 한다(fetch). ssh 원격도 암호·호스트 확인을 묻지 않고 실패한다.
const env = (): NodeJS.ProcessEnv => ({ ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes' });

export function git(root: string, args: string[], opts: GitOptions = {}): GitResult {
  let res: SpawnSyncReturns<string>;
  try {
    res = spawnSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
      timeout: opts.timeoutMs ?? GIT_TIMEOUT_MS,
      input: opts.input,
      env: env(),
    });
  } catch (e) {
    // 인자 검사(NUL 바이트 등)에서 spawnSync 가 동기로 던진다.
    return { ok: false, stdout: '', stderr: e instanceof Error ? e.message : String(e) };
  }
  const stdout = res.stdout ?? '';
  const stderr = res.stderr ?? '';
  if (res.error) return { ok: false, stdout, stderr: stderr !== '' ? stderr : res.error.message };
  return { ok: res.status === 0, stdout, stderr };
}

/** 바이트 그대로의 stdout(이미지 등). 실패면 null 이다. input 은 stdin 으로 간다(`cat-file --batch`). */
export function gitBytes(root: string, args: string[], opts: GitOptions = {}): Buffer | null {
  let res: SpawnSyncReturns<Buffer>;
  try {
    res = spawnSync('git', ['-C', root, ...args], {
      maxBuffer: MAX_BUFFER,
      timeout: opts.timeoutMs ?? GIT_TIMEOUT_MS,
      input: opts.input,
      env: env(),
    });
  } catch {
    return null;
  }
  if (res.error || res.status !== 0) return null;
  return res.stdout;
}

export type GitAsyncFn = (root: string, args: string[], opts?: Pick<GitOptions, 'timeoutMs'>) => Promise<GitResult>;

/**
 * 이벤트 루프를 막지 않는 git(fetch 용). 예외·거부 없이 git 과 같은 꼴로 끝난다.
 * 시간이 지나면 프로세스를 죽이고 ok:false 다.
 */
export const gitAsync: GitAsyncFn = (root, args, opts = {}) =>
  new Promise((resolve) => {
    let out = '';
    let err = '';
    let done = false;
    const finish = (r: GitResult): void => {
      if (done) return;
      done = true;
      resolve(r);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('git', ['-C', root, ...args], { env: env(), timeout: opts.timeoutMs ?? GIT_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      finish({ ok: false, stdout: '', stderr: e instanceof Error ? e.message : String(e) });
      return;
    }
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (c: string) => {
      if (out.length < MAX_BUFFER) out += c;
    });
    child.stderr?.on('data', (c: string) => {
      if (err.length < MAX_BUFFER) err += c;
    });
    child.on('error', (e) => finish({ ok: false, stdout: out, stderr: err !== '' ? err : e.message }));
    child.on('close', (code, signal) => {
      if (signal !== null && code === null) finish({ ok: false, stdout: out, stderr: err !== '' ? err : `git 이 멈췄다(${signal})` });
      else finish({ ok: code === 0, stdout: out, stderr: err });
    });
  });
