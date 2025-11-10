/**
 * Abstraction for managing pseudo-terminal (PTY) processes.
 */
export interface IPtyService {
  /**
   * Launch a PTY process and register it by ID.
   * @param options Configuration describing the PTY target shell and environment.
   * @returns The ID associated with the created PTY.
   */
  startPty(options: {
    id: string;
    cwd?: string;
    shell?: string;
    env?: NodeJS.ProcessEnv;
    cols?: number;
    rows?: number;
  }): Promise<string>;

  /**
   * Write raw data to a running PTY.
   * @param id PTY identifier.
   * @param data UTF-8 payload to send to the PTY stdin.
   */
  writePty(id: string, data: string): void;

  /**
   * Resize a running PTY to match the caller's viewport.
   * @param id PTY identifier.
   * @param cols Target column count.
   * @param rows Target row count.
   */
  resizePty(id: string, cols: number, rows: number): void;

  /**
   * Terminate a PTY and release its resources.
   * @param id PTY identifier.
   */
  killPty(id: string): void;
}
