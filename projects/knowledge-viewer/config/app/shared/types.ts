// 서버와 화면이 함께 쓰는 형.
export type Entry = {
  name: string;
  path: string;
  kind: 'dir' | 'md' | 'html' | 'file';
  ignored: boolean;
};

export type Heading = { depth: number; text: string; slug: string; line: number };
