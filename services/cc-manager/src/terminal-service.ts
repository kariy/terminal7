import { log } from "./logger";

export interface TerminalHandle {
	write(data: Buffer | string): void;
	resize(cols: number, rows: number): void;
	close(): void;
}

export interface TerminalOpenParams {
	sshDestination: string;
	sshPassword?: string;
	remoteCommand: string;
	cols: number;
	rows: number;
	onData: (data: Buffer) => void;
	onExit: (code: number | null) => void;
}

export interface TerminalServiceLike {
	open(params: TerminalOpenParams): TerminalHandle;
}

// Python script that spawns a command in a PTY, auto-sends a password
// when it detects the SSH password prompt, then relays I/O normally.
const PTY_HELPER_SCRIPT = `
import pty, os, sys, select, errno

password = os.environ.get("SSH_AUTO_PASSWORD", "")
cmd = sys.argv[1:]

pid, fd = pty.fork()
if pid == 0:
    os.execvp(cmd[0], cmd)

sent = False
try:
    while True:
        try:
            r, _, _ = select.select([fd, 0], [], [], 0.1)
        except (ValueError, OSError):
            break
        if fd in r:
            try:
                data = os.read(fd, 4096)
            except OSError as e:
                if e.errno == errno.EIO:
                    break
                raise
            if not data:
                break
            os.write(1, data)
            if not sent and password and b"assword" in data:
                os.write(fd, (password + "\\n").encode())
                sent = True
        if 0 in r:
            try:
                data = os.read(0, 4096)
            except OSError:
                break
            if not data:
                break
            os.write(fd, data)
except KeyboardInterrupt:
    pass

try:
    _, status = os.waitpid(pid, 0)
    sys.exit(os.waitstatus_to_exitcode(status))
except ChildProcessError:
    sys.exit(1)
`.trim();

export class TerminalService implements TerminalServiceLike {
	open(params: TerminalOpenParams): TerminalHandle {
		const { sshDestination, sshPassword, remoteCommand, cols, rows, onData, onExit } = params;

		const sizeSetup = `stty rows ${rows} cols ${cols} 2>/dev/null;`;
		const fullCommand = `${sizeSetup} ${remoteCommand}`;

		const sshArgs = ["ssh", "-t", "-o", "StrictHostKeyChecking=accept-new", sshDestination, fullCommand];
		const args = ["python3", "-c", PTY_HELPER_SCRIPT, ...sshArgs];

		log.terminal(`spawning ssh to ${sshDestination} cols=${cols} rows=${rows} password=${sshPassword ? "yes" : "no"}`);
		log.terminal(`remote command: ${remoteCommand}`);

		const env = { ...process.env, TERM: "xterm-256color" };
		if (sshPassword) {
			env.SSH_AUTO_PASSWORD = sshPassword;
		}

		let proc: ReturnType<typeof Bun.spawn>;
		try {
			proc = Bun.spawn(args, {
				stdin: "pipe",
				stdout: "pipe",
				stderr: "pipe",
				env,
			});
			log.terminal(`process spawned pid=${proc.pid}`);
		} catch (err) {
			log.terminal(`failed to spawn process: ${err}`);
			throw err;
		}

		let closed = false;

		const readStream = async (name: string, stream: ReadableStream<Uint8Array> | null) => {
			if (!stream) {
				log.terminal(`pid=${proc.pid} ${name}: no stream`);
				return;
			}
			log.terminal(`pid=${proc.pid} ${name}: reading`);
			const reader = stream.getReader();
			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) {
						log.terminal(`pid=${proc.pid} ${name}: stream ended`);
						break;
					}
					const text = Buffer.from(value).toString();
					log.terminal(`pid=${proc.pid} ${name}: ${text.length} bytes: ${text.trimEnd()}`);
					if (!closed) {
						onData(Buffer.from(value));
					}
				}
			} catch (err) {
				log.terminal(`pid=${proc.pid} ${name}: stream error: ${err}`);
			}
		};

		readStream("stdout", proc.stdout as ReadableStream<Uint8Array>);
		readStream("stderr", proc.stderr as ReadableStream<Uint8Array>);

		proc.exited.then((code) => {
			log.terminal(`pid=${proc.pid} exited code=${code}`);
			if (!closed) {
				closed = true;
				onExit(code);
			}
		});

		return {
			write(data: Buffer | string) {
				if (closed) return;
				try {
					proc.stdin?.write(data);
				} catch (err) {
					log.terminal(`pid=${proc.pid} stdin write error: ${err}`);
				}
			},
			resize(newCols: number, newRows: number) {
				if (closed) return;
				log.terminal(`pid=${proc.pid} resize cols=${newCols} rows=${newRows}`);
				try {
					proc.stdin?.write(`stty rows ${newRows} cols ${newCols} 2>/dev/null\n`);
				} catch (err) {
					log.terminal(`pid=${proc.pid} resize write error: ${err}`);
				}
			},
			close() {
				log.terminal(`pid=${proc.pid} close requested (closed=${closed})`);
				if (closed) return;
				closed = true;
				try {
					proc.kill();
					log.terminal(`pid=${proc.pid} killed`);
				} catch (err) {
					log.terminal(`pid=${proc.pid} kill error: ${err}`);
				}
			},
		};
	}
}
