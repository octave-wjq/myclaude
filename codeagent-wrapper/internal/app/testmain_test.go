package wrapper

import (
	"os"
	"testing"
)

// Unit tests must never load credentials or agent defaults from the real home.
func TestMain(m *testing.M) {
	home, err := os.MkdirTemp("", "codeagent-app-tests-")
	if err != nil {
		panic(err)
	}
	os.Setenv("HOME", home)
	os.Setenv("USERPROFILE", home)
	code := m.Run()
	os.RemoveAll(home)
	os.Exit(code)
}
