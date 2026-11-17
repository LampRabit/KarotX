package driver

import (
	"strings"
	"unicode"
)

// SplitSQL splits a script into statements on top-level semicolons, skipping
// quotes, comments and Postgres dollar-quoted bodies. hashComments enables
// MySQL's "# comment" syntax (in Postgres # is an operator).
func SplitSQL(src string, hashComments bool) []string {
	var out []string
	start := 0
	push := func(end int) {
		if s := strings.TrimSpace(src[start:end]); s != "" && !isOnlyComments(s) {
			out = append(out, s)
		}
	}
	for i := 0; i < len(src); i++ {
		switch c := src[i]; {
		case c == '\'' || c == '"' || c == '`':
			i = skipQuoted(src, i, c)
		case c == '-' && strings.HasPrefix(src[i:], "--"), c == '#' && hashComments:
			for i < len(src) && src[i] != '\n' {
				i++
			}
		case c == '/' && strings.HasPrefix(src[i:], "/*"):
			if end := strings.Index(src[i+2:], "*/"); end >= 0 {
				i += end + 3
			} else {
				i = len(src)
			}
		case c == '$':
			if tag := dollarTag(src[i:]); tag != "" {
				if end := strings.Index(src[i+len(tag):], tag); end >= 0 {
					i += len(tag) + end + len(tag) - 1
				} else {
					i = len(src)
				}
			}
		case c == ';':
			push(i)
			start = i + 1
		}
	}
	push(len(src))
	return out
}

func skipQuoted(s string, i int, q byte) int {
	for j := i + 1; j < len(s); j++ {
		if s[j] == '\\' && q != '"' {
			j++
			continue
		}
		if s[j] == q {
			if j+1 < len(s) && s[j+1] == q { // doubled quote
				j++
				continue
			}
			return j
		}
	}
	return len(s)
}

func dollarTag(s string) string {
	for j := 1; j < len(s); j++ {
		if s[j] == '$' {
			return s[:j+1]
		}
		if r := rune(s[j]); !(unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_') {
			return ""
		}
	}
	return ""
}

func isOnlyComments(s string) bool {
	for _, line := range strings.Split(s, "\n") {
		l := strings.TrimSpace(line)
		if l != "" && !strings.HasPrefix(l, "--") && !strings.HasPrefix(l, "#") {
			return false
		}
	}
	return true
}

// FirstKeyword returns the statement's leading keyword, uppercased,
// ignoring leading comments and parentheses.
func FirstKeyword(stmt string) string {
	s := stmt
	for {
		s = strings.TrimLeft(s, " \t\r\n(")
		switch {
		case strings.HasPrefix(s, "--"), strings.HasPrefix(s, "#"):
			if i := strings.IndexByte(s, '\n'); i >= 0 {
				s = s[i+1:]
				continue
			}
			return ""
		case strings.HasPrefix(s, "/*"):
			if i := strings.Index(s, "*/"); i >= 0 {
				s = s[i+2:]
				continue
			}
			return ""
		}
		break
	}
	end := strings.IndexFunc(s, func(r rune) bool { return !unicode.IsLetter(r) })
	if end < 0 {
		end = len(s)
	}
	return strings.ToUpper(s[:end])
}

var rowKeywords = map[string]bool{
	"SELECT": true, "WITH": true, "SHOW": true, "EXPLAIN": true, "DESCRIBE": true,
	"DESC": true, "PRAGMA": true, "VALUES": true, "TABLE": true,
}

// ReturnsRows guesses whether a statement produces a result set.
func ReturnsRows(stmt string) bool {
	return rowKeywords[FirstKeyword(stmt)] || strings.Contains(strings.ToUpper(stmt), "RETURNING")
}

var destructive = map[string]bool{
	"DROP": true, "TRUNCATE": true, "DELETE": true, "UPDATE": true, "ALTER": true,
	"RENAME": true, "REPLACE": true, "GRANT": true, "REVOKE": true, "MERGE": true,
}

// IsDestructive reports statements that change or remove existing data or schema.
func IsDestructive(stmt string) bool {
	k := FirstKeyword(stmt)
	if k == "WITH" { // data-modifying CTE
		u := strings.ToUpper(stmt)
		return strings.Contains(u, "DELETE") || strings.Contains(u, "UPDATE")
	}
	return destructive[k]
}
