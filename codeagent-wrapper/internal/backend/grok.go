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
	env := map[string]string{"CODEAGENT_WORKER": "1"}
	if baseURL != "" {
		env["GROK_MODELS_BASE_URL"] = baseURL
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

	args := []string{"--output-format", "streaming-messages-json", "--no-subagents", "--no-plan",
		"--rules", "You are a delegated worker. Implement and test the assigned work directly. Do not invoke codeagent, Claude, Codex or other agents. Preserve unrelated changes and report verification results."}

	// Headless ask mode cancels edits; auto retains Grok's safety checks.
	if cfg.SkipPermissions || cfg.Yolo || config.EnvFlagEnabled("CODEAGENT_SKIP_PERMISSIONS") {
		args = append(args, "--permission-mode", "bypassPermissions")
	} else {
		args = append(args, "--permission-mode", "auto")
	}

	model := strings.TrimSpace(cfg.Model)
	if model == "" {
		model = "grok-4.6"
	}
	effort := strings.TrimSpace(cfg.ReasoningEffort)
	if effort == "" {
		effort = "low"
	}
	args = append(args, "--model", model, "--reasoning-effort", effort)
	if cfg.WorkDir != "" {
		args = append(args, "--cwd", cfg.WorkDir)
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
