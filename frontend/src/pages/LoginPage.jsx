import { useEffect, useState } from 'react'
import { ArrowRight, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api'
import AuthShell from '../components/AuthShell'
import { useAuth } from '../auth/useAuth'

export default function LoginPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice] = useState(() => sessionStorage.getItem('gpt-clone-auth-notice') || '')

  useEffect(() => {
    if (notice) sessionStorage.removeItem('gpt-clone-auth-notice')
  }, [notice])

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    if (!/^\S+@\S+\.\S+$/.test(email.trim()) || !password) {
      setError('Enter a valid email address and password.')
      return
    }

    setLoading(true)
    try {
      const result = await api.login({ email: email.trim(), password })
      signIn(result.user)
      sessionStorage.removeItem('gpt-clone-auth-notice')
      navigate(location.state?.from || '/', { replace: true })
    } catch (requestError) {
      setError(requestError.message || 'We could not sign you in. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell mode="login" notice={notice}>
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <label className="field-label" htmlFor="login-email">Email address</label>
        <div className="input-wrap">
          <Mail size={17} />
          <input id="login-email" autoComplete="email" type="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </div>

        <div className="field-row">
          <label className="field-label" htmlFor="login-password">Password</label>
        </div>
        <div className="input-wrap">
          <LockKeyhole size={17} />
          <input id="login-password" autoComplete="current-password" type={showPassword ? 'text' : 'password'} placeholder="Enter your password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          <button className="input-icon-button" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((shown) => !shown)}>
            {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>

        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="auth-submit" type="submit" disabled={loading}>
          {loading ? <><LoaderCircle className="spin" size={16} /> Signing in…</> : <>Sign in <ArrowRight size={15} /></>}
        </button>
        <p className="auth-security"><LockKeyhole size={13} /> Your session is protected with an http-only cookie.</p>
      </form>
    </AuthShell>
  )
}
