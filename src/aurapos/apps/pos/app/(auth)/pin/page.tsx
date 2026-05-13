"use client";
import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function PinPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const email = searchParams.get("email");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    if (!email) {
      setError("Email not provided");
      setLoading(false);
      return;
    }

    if (pin.length !== 6 || !/^\d+$/.test(pin)) {
      setError("PIN must be exactly 6 digits");
      setLoading(false);
      return;
    }

    const { error: otpError } = await supabase.auth.verifyOtp({
      type: "email",
      email,
      token: pin,
    });

    if (otpError) {
      setError(otpError.message);
      setLoading(false);
    } else {
      setSuccess(true);
      // Redirect to home after successful verification
      router.push("/");
    }
  };

  if (!email) {
    return <div>Error: Email parameter missing</div>;
  }

  return (
    <div style={styles.container}>
      <h1>Verify Your Email</h1>
      <p>Enter the 6-digit PIN sent to {email}</p>
      <form onSubmit={handleSubmit} style={styles.form}>
        <input
          type="text"
          inputMode="numeric"
          maxLength="6"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          disabled={loading}
          style={styles.input}
        />
        {error && <p style={styles.error}>{error}</p>}
        {success && <p style={styles.success}>Verification successful!</p>}
        <button type="submit" disabled={loading} style={styles.button}>
          {loading ? "Verifying..." : "Verify"}
        </button>
      </form>
    </div>
  );
}

const styles = {
  container: {
    maxWidth: "400px",
    margin: "2rem auto",
    padding: "2rem",
    border: "1px solid #ddd",
    borderRadius: "8px",
    textAlign: "center",
  },
  form: {
    marginTop: "1.5rem",
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
  },
  input: {
    padding: "0.75rem",
    fontSize: "1.25rem",
    textAlign: "center",
    fontFamily: "monospace",
    letterSpacing: "0.25rem",
    width: "100%",
    boxSizing: "border-box",
  },
  error: {
    color: "#d32f2f",
    fontSize: "0.875rem",
  },
  success: {
    color: "#388e3c",
    fontSize: "0.875rem",
  },
  button: {
    padding: "0.