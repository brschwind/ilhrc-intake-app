import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const handlers = app.slice(app.indexOf("  async function finishStaffLogin("), app.indexOf("  async function requestPasswordReset("));
function setup(overrides = {}) {
  const state = {};
  const dependencies = {
    loginEmail: " staff@example.org ", loginPassword: "test-password", loginLoading: false,
    supabase: { auth: { signInWithPassword: async (credentials) => {
      state.credentials = credentials;
      return { data: { session: { access_token: "test" } }, error: null };
    } } },
    refreshProfile: async () => ({ is_active: true }),
    setLoginLoading: (value) => { state.loading = value; },
    setAuthMessage: (value) => { state.error = value; },
    setLoginPassword: () => {},
    setStaffSignInOpen: (value) => { state.open = value; },
    setView: (value) => { state.view = value; },
    ...overrides,
  };
  const login = new Function(...Object.keys(dependencies), handlers + "return handleLogin;")(...Object.values(dependencies));
  return { state, run: () => login({ preventDefault() {} }) };
}
test("password sign-in trims email and enters workspace after profile check", async () => {
  const flow = setup(); await flow.run();
  assert.deepEqual(flow.state.credentials, { email: "staff@example.org", password: "test-password" });
  assert.equal(flow.state.view, "add"); assert.equal(flow.state.open, false);
  assert.equal(flow.state.loading, false);
});
test("inactive accounts remain outside the workspace", async () => {
  const flow = setup({ refreshProfile: async () => ({ is_active: false }) }); await flow.run();
  assert.equal(flow.state.view, undefined); assert.match(flow.state.error, /inactive/);
});
test("incorrect password allows retry without entering workspace", async () => {
  const flow = setup({ supabase: { auth: { signInWithPassword: async () => ({ data: {}, error: {} }) } } }); await flow.run();
  assert.match(flow.state.error, /Invalid email or password/); assert.equal(flow.state.loading, false);
  assert.equal(flow.state.view, undefined);
});
test("connection failure releases loading state", async () => {
  const flow = setup({ supabase: { auth: { signInWithPassword: async () => { throw new Error("offline"); } } } }); await flow.run();
  assert.match(flow.state.error, /connect/); assert.equal(flow.state.loading, false);
});
