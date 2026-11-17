// Package model holds the persisted connection configuration shared by the
// server, connection manager and drivers. Nothing here is secret: passwords
// and passphrases live in the OS keychain (see Secrets).
package model

import (
	"errors"
	"strings"
)

type Connection struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Driver   string `json:"driver"`           // postgres | mysql | sqlite
	Preset   string `json:"preset,omitempty"` // supabase, neon, mariadb, ... (UI hint)
	Color    string `json:"color,omitempty"`
	Host     string `json:"host,omitempty"`
	Port     int    `json:"port,omitempty"`
	User     string `json:"user,omitempty"`
	Database string `json:"database,omitempty"`
	File     string `json:"file,omitempty"` // sqlite

	TLS TLS  `json:"tls"`
	SSH *SSH `json:"ssh,omitempty"`

	// Production marks a connection as sensitive: the UI asks before running
	// destructive statements.
	Production bool `json:"production,omitempty"`
	// ReadOnly is enforced by the database session itself.
	ReadOnly bool `json:"readOnly,omitempty"`
}

type TLS struct {
	Mode     string `json:"mode,omitempty"` // off | prefer | require | verify
	CAFile   string `json:"caFile,omitempty"`
	CertFile string `json:"certFile,omitempty"`
	KeyFile  string `json:"keyFile,omitempty"`
}

// SSH describes a tunnel. Hops[0] is the first server dialled; the last hop
// opens the connection to the database. More than one hop = jump hosts.
type SSH struct {
	Hops []SSHHop `json:"hops"`
}

type SSHHop struct {
	Host    string `json:"host"`
	Port    int    `json:"port,omitempty"`
	User    string `json:"user"`
	Auth    string `json:"auth"`              // password | key | agent
	KeyFile string `json:"keyFile,omitempty"` // for auth=key
	// HostKey is the trusted SHA256 fingerprint, pinned on first connect.
	HostKey string `json:"hostKey,omitempty"`
}

// Secrets for one connection, stored as a single keychain entry.
type Secrets struct {
	Password string   `json:"password,omitempty"`
	SSH      []string `json:"ssh,omitempty"` // per hop: password or key passphrase
}

func (c *Connection) Validate() error {
	c.Name = strings.TrimSpace(c.Name)
	if c.Name == "" {
		return errors.New("give the connection a name")
	}
	switch c.Driver {
	case "sqlite":
		if c.File == "" {
			return errors.New("choose a database file")
		}
	case "postgres", "mysql":
		if c.Host == "" {
			return errors.New("enter a host")
		}
	default:
		return errors.New("unsupported database type " + c.Driver)
	}
	if c.SSH != nil {
		for i := range c.SSH.Hops {
			h := &c.SSH.Hops[i]
			if h.Host == "" || h.User == "" {
				return errors.New("every SSH server needs a host and user")
			}
			if h.Port == 0 {
				h.Port = 22
			}
			if h.Auth == "key" && h.KeyFile == "" {
				return errors.New("choose a private key file for SSH")
			}
		}
		if len(c.SSH.Hops) == 0 {
			c.SSH = nil
		}
	}
	return nil
}
