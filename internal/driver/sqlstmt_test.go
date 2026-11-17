package driver

import (
	"reflect"
	"testing"
)

func TestSplitSQL(t *testing.T) {
	cases := map[string][]string{
		"select 1; select 2;":                         {"select 1", "select 2"},
		"select ';' ; select 2":                       {"select ';'", "select 2"},
		"-- a; comment\nselect 1":                     {"-- a; comment\nselect 1"},
		"select 1 /* ; */; select 2":                  {"select 1 /* ; */", "select 2"},
		"create function f() as $$ a; b $$; select 1": {"create function f() as $$ a; b $$", "select 1"},
		"select 'it''s;'; select 2":                   {"select 'it''s;'", "select 2"},
		"  ;; -- only comment":                        nil,
		"select d #> '{a}'; select 2":                 {"select d #> '{a}'", "select 2"},
		"CREATE TRIGGER t AFTER INSERT ON x BEGIN UPDATE y SET a = CASE WHEN 1 THEN 2 END; DELETE FROM z; END; select 1": {
			"CREATE TRIGGER t AFTER INSERT ON x BEGIN UPDATE y SET a = CASE WHEN 1 THEN 2 END; DELETE FROM z; END", "select 1"},
		"BEGIN; select 1; COMMIT": {"BEGIN", "select 1", "COMMIT"},
	}
	for in, want := range cases {
		if got := SplitSQL(in, false); !reflect.DeepEqual(got, want) {
			t.Errorf("SplitSQL(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestSplitSQLHashComments(t *testing.T) {
	if got := SplitSQL("# a; b\nselect 1", true); len(got) != 1 {
		t.Errorf("got %q", got)
	}
}

func TestClassify(t *testing.T) {
	if !ReturnsRows("  (select 1)") || !ReturnsRows("insert into t values (1) returning id") || ReturnsRows("insert into t values (1)") {
		t.Error("ReturnsRows")
	}
	for _, s := range []string{"DROP TABLE x", "-- hi\ndelete from t", "with x as (delete from t returning *) select 1", "update t set a=1"} {
		if !IsDestructive(s) {
			t.Errorf("IsDestructive(%q) = false", s)
		}
	}
	for _, s := range []string{"select 1", "insert into t values (1)", "create table t (a int)"} {
		if IsDestructive(s) {
			t.Errorf("IsDestructive(%q) = true", s)
		}
	}
}
