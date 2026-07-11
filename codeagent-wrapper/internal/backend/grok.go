package backend

import (
	"strings"

	config "codeagent-wrapper/internal/config"
)

type GrokBackend struct{}

func (GrokBackend) Name() string    { return "grok" }
func (GrokBackend) Command() string { return "grok" }

// Env maps optional base URL / API key to grok's xAI environment variables.
// grok normally authenticates via `grok login` (OAuth), so both may be empty.
func (GrokBackend) Env(baseURL, apiKey string) map[string]string {
	baseURL = strings.TrimSpace(baseURL)
	apiKey = strings.TrimSpace(apiKey)
	if baseURL == "" && apiKey == "" {
		return nil
	}
	env := make(map[string]string, 2)
	if baseURL != "" {
		env["XAI_BASE_URL"] = baseURL
	}
	if apiKey != "" {
		env["XAI_API_KEY"] = apiKey
	}
	return env
}

func (GrokBackend) BuildArgs(cfg *config.Config, targetArg string) []string {
	return buildGrokArgs(cfg, targetArg)
}

// buildGrokArgs builds the grok CLI argument list. grok runs headless with
// streaming JSON output and per-tool permission rules. Unlike codex/claude,
// grok's -p treats "-" as a literal prompt rather than a stdin sentinel, so
// stdin mode is wired through --prompt-file /dev/stdin instead.
func buildGrokArgs(cfg *config.Config, targetArg string) []string {
	if cfg == nil {
		return nil
	}

	args := []string{"--output-format", "streaming-json"}

	// Default to bypassing approvals unless CODEAGENT_SKIP_PERMISSIONS=false.
	if cfg.SkipPermissions || cfg.Yolo || config.EnvFlagDefaultTrue("CODEAGENT_SKIP_PERMISSIONS") {
		logWarnFn("YOLO/skip-permissions enabled: grok running with bypassPermissions")
		args = append(args, "--permission-mode", "bypassPermissions")
	}

	if model := strings.TrimSpace(cfg.Model); model != "" {
		args = append(args, "-m", model)
	}

	if effort := strings.TrimSpace(cfg.ReasoningEffort); effort != "" {
		args = append(args, "--reasoning-effort", effort)
	}

	for _, tool := range cfg.AllowedTools {
		if t := strings.TrimSpace(tool); t != "" {
			args = append(args, "--allow", t)
		}
	}
	for _, tool := range cfg.DisallowedTools {
		if t := strings.TrimSpace(tool); t != "" {
			args = append(args, "--deny", t)
		}
	}

	if cfg.Mode == "resume" && strings.TrimSpace(cfg.SessionID) != "" {
		args = append(args, "-r", cfg.SessionID)
	}

	// Single-turn headless prompt. The wrapper signals stdin mode with "-",
	// but grok's -p would treat "-" as the literal prompt text, so read the
	// piped task from /dev/stdin instead.
	if targetArg == "-" {
		args = append(args, "--prompt-file", "/dev/stdin")
	} else {
		args = append(args, "-p", targetArg)
	}

	return args
}
