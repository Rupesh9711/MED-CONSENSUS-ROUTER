import { useEffect, useState } from "react";
import Dashboard from "./components/Dashboard.jsx";
import dashboardStyles from "./components/Dashboard.module.css";

const BACKEND_ORIGIN = "http://localhost:5000";
const SESSION_TOKEN_STORAGE_KEY = "medRouterSessionToken";
const SESSION_EMAIL_STORAGE_KEY = "medRouterPatientEmail";

function clearPersistedSession() {
  window.localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
  window.localStorage.removeItem(SESSION_EMAIL_STORAGE_KEY);
  window.sessionStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
  window.sessionStorage.removeItem(SESSION_EMAIL_STORAGE_KEY);
}

export default function App() {
  const [sessionToken, setSessionToken] = useState("");
  const [patientEmail, setPatientEmail] = useState("");
  const [authMode, setAuthMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authErrorMessage, setAuthErrorMessage] = useState("");
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false);

  useEffect(
    function bindEphemeralSessionLifetime() {
      clearPersistedSession();

      function endSessionOnClose() {
        clearPersistedSession();
      }

      window.addEventListener("pagehide", endSessionOnClose);
      window.addEventListener("beforeunload", endSessionOnClose);

      return function removeCloseListeners() {
        endSessionOnClose();
        window.removeEventListener("pagehide", endSessionOnClose);
        window.removeEventListener("beforeunload", endSessionOnClose);
      };
    },
    []
  );

  function beginSession(nextSessionToken, nextPatientEmail) {
    clearPersistedSession();
    setSessionToken(nextSessionToken);
    setPatientEmail(nextPatientEmail);
  }

  function endSession() {
    clearPersistedSession();
    setSessionToken("");
    setPatientEmail("");
    setPassword("");
  }

  async function submitAuthentication(event) {
    event.preventDefault();
    setIsSubmittingAuth(true);
    setAuthErrorMessage("");

    const routePath = authMode === "signup" ? "/api/auth/signup" : "/api/auth/login";

    try {
      const response = await fetch(BACKEND_ORIGIN + routePath, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: email,
          password: password
        })
      });
      const payload = await response.json();
      if(!response.ok) {
        setAuthErrorMessage(payload.message || "Authentication failed.");
        setIsSubmittingAuth(false);
        return;
      }
      beginSession(payload.sessionToken, payload.email);
    } catch (_networkError) {
      setAuthErrorMessage("The companion backend is unreachable. Start the Express runner on port 5000.");
    }

    setIsSubmittingAuth(false);
  }

  if (sessionToken) {
    return (
      <Dashboard
        sessionToken={sessionToken}
        patientEmail={patientEmail}
        onLogout={endSession}
      />
    );
  }

  return (
    <div className={dashboardStyles.gatewayCanvas}>
      <form className={dashboardStyles.gatewayCard} onSubmit={submitAuthentication}>
        <p className={dashboardStyles.eyebrow}>Personal health companion</p>
        <h1 className={dashboardStyles.gatewayTitle}>Medication Consensus Router</h1>
        <p className={dashboardStyles.gatewayCopy}>
          A Direct-to-Consumer workspace. Sign in to recover your saved medications, then route
          prescriptions through chemical conflict detection and Welsh-Powell coloring. Closing this
          window ends the session.
        </p>
           
        <div className={dashboardStyles.authToggle}>
          <button
            className={
              authMode === "login"
                ? `${dashboardStyles.toggleButton} ${dashboardStyles.toggleButtonActive}`
                : dashboardStyles.toggleButton
            }
            type="button"
            onClick={function switchToLogin() {
              setAuthMode("login");
              setAuthErrorMessage("");
            }}
          >
            Login
          </button>
          <button
            className={
              authMode === "signup"
                ? `${dashboardStyles.toggleButton} ${dashboardStyles.toggleButtonActive}`
                : dashboardStyles.toggleButton
            }
            type="button"
            onClick={function switchToSignup() {
              setAuthMode("signup");
              setAuthErrorMessage("");
            }}
          >
            Sign up
          </button>
        </div>

        {authErrorMessage ? <p className={dashboardStyles.authError}>{authErrorMessage}</p> : null}

        <label className={dashboardStyles.fieldGroup}>
          <span className={dashboardStyles.fieldLabel}>Email</span>
          <input
            className={dashboardStyles.textInput}
            type="email"
            value={email}
            onChange={function onEmailChange(event) {
              setEmail(event.target.value);
            }}
            required
          />
        </label>

        <label className={dashboardStyles.fieldGroup} style={{ marginTop: "14px" }}>
          <span className={dashboardStyles.fieldLabel}>Password</span>
          <input
            className={dashboardStyles.textInput}
            type="password"
            value={password}
            onChange={function onPasswordChange(event) {
              setPassword(event.target.value);
            }}
            required
            minLength={8}
          />
        </label>

        <button
          className={dashboardStyles.generateButton}
          type="submit"
          disabled={isSubmittingAuth}
          style={{ width: "100%", marginTop: "22px" }}
        >
          {isSubmittingAuth ? "Opening session..." : authMode === "signup" ? "Create companion account" : "Enter workspace"}
        </button>
      </form>
    </div>
  );
}
