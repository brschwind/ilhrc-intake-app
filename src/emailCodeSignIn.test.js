import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const handlers = app.slice(app.indexOf("  async function finishStaffLogin("), app.indexOf("  async function requestPasswordReset("));
function setup(overrides = {}) {
  const state = { email: " staff@example.org ", method: "code", sentTo: "", code: "123456", loading: false, resendAt: 0 };
  const calls = [];
  const dependencies = {
    supabase: { auth: {
      signInWithOtp: async (args) => { calls.push(args); return { error: null }; },
      verifyOtp: async (args) => { calls.push(args); return { data: { session: { access_token: "test" } }, error: null }; },
    } },
    refreshProfile: async () => ({ is_active: true }),
    setLoginLoading: (value) => { state.loading = value; },
    setAuthMessage: (value) => { state.error = value; },
    setCodeMessage: (value) => { state.message = value; },
    setCodeSentTo: (value) => { state.nextSentTo = value; },
    setLoginCode: () => {}, setCodeResendAt: () => {}, setLoginPassword: () => {},
    setStaffSignInOpen: (value) => { state.open = value; },
    setView: (value) => { state.view = value; },
    ...overrides,
  };
  return { state, calls, run: async () => {
    const args = { ...dependencies, loginEmail: state.email, loginMethod: state.method, codeSentTo: state.sentTo,
      loginCode: state.code, loginLoading: state.loading, codeResendAt: state.resendAt };
    const login = new Function(...Object.keys(args), handlers + "return handleLogin;")(...Object.values(args));
    await login({ preventDefault() {} });
  } };
}

test("code request trims email and cannot create accounts", async () => {
  const flow = setup(); await flow.run();
  assert.deepEqual(flow.calls, [{ email: "staff@example.org", options: { shouldCreateUser: false } }]);
  assert.equal(flow.state.nextSentTo, "staff@example.org");
  assert.equal(flow.state.loading, false);
  assert.equal(flow.state.view, undefined);
});
test("valid code opens staff workspace after profile check", async () => {
  const flow = setup(); flow.state.sentTo = "staff@example.org"; await flow.run();
  assert.deepEqual(flow.calls, [{ email: "staff@example.org", token: "123456", type: "email" }]);
  assert.equal(flow.state.view, "add"); assert.equal(flow.state.open, false);
});
test("inactive team member cannot enter staff workspace", async () => {
  const flow = setup({ refreshProfile: async () => ({ is_active: false }) });
  flow.state.sentTo = "staff@example.org"; await flow.run();
  assert.equal(flow.state.view, undefined); assert.match(flow.state.error, /inactive/);
});
test("expired code keeps sign-in open and releases loading state", async () => {
  const flow = setup({ supabase: { auth: { verifyOtp: async () => ({ data: {}, error: { message: "expired" } }) } } });
  flow.state.sentTo = "staff@example.org"; await flow.run();
  assert.match(flow.state.error, /invalid or expired/); assert.equal(flow.state.loading, false);
  assert.equal(flow.state.view, undefined);
});
test("network errors release loading state and allow retry", async () => {
  const flow = setup({ supabase: { auth: { signInWithOtp: async () => { throw new Error("offline"); } } } });
  await flow.run(); assert.match(flow.state.error, /connect/); assert.equal(flow.state.loading, false);
});
test("resend cooldown prevents another email request", async () => {
  const flow = setup(); flow.state.resendAt = Date.now() + 60000; await flow.run();
  assert.equal(flow.calls.length, 0); assert.match(flow.state.error, /wait a minute/);
});
