export type RemotePtyServerMessage =
  | {
      type: 'pty:data';
      id: string;
      data: string;
    }
  | {
      type: 'pty:exit';
      id: string;
      exitCode?: number;
      signal?: string;
    };

export type RemotePtyClientMessage =
  | {
      type: 'input';
      data: string;
    }
  | {
      type: 'resize';
      cols: number;
      rows: number;
    }
  | {
      type: 'kill';
    };
