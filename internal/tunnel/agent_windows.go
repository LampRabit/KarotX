package tunnel

import (
	"net"
	"os"
	"time"

	"github.com/Microsoft/go-winio"
)

// dialAgent connects to SSH_AUTH_SOCK if set, otherwise the Windows OpenSSH agent pipe.
func dialAgent() (net.Conn, error) {
	if sock := os.Getenv("SSH_AUTH_SOCK"); sock != "" {
		if c, err := net.Dial("unix", sock); err == nil {
			return c, nil
		}
	}
	timeout := 3 * time.Second
	return winio.DialPipe(`\\.\pipe\openssh-ssh-agent`, &timeout)
}
