import { useState } from 'react'
import { ArrowRight, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail, UserRound } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import AuthShell from '../components/AuthShell'
import { useAuth } from '../auth/useAuth'

export default function RegisterPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    if (!firstName.trim() || !lastName.trim() || !/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError('Enter your first name, last name, and a valid email address.')
      return
    }
    if (password.length < 8 || password.length > 128) {
      setError('Your password must be between 8 and 128 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Those passwords do not match.')
      return
    }

    setLoading(true)
    try {
      const result = await api.register({
        fullName: { firstName: firstName.trim(), lastName: lastName.trim() },
        email: email.trim(),
        password,
      })
      signIn(result.user)
      navigate('/', { replace: true })
    } catch (requestError) {
      setError(requestError.message || 'We could not create your account. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell mode="register">
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <div className="name-fields">
          <label className="field-label" htmlFor="first-name">First name</label>
          <label className="field-label" htmlFor="last-name">Last name</label>
          <div className="input-wrap"><UserRound size={17} /><input id="first-name" autoComplete="given-name" placeholder="First name" value={firstName} onChange={(event) => setFirstName(event.target.value)} required /></div>
          <div className="input-wrap"><input id="last-name" autoComplete="family-name" placeholder="Last name" value={lastName} onChange={(event) => setLastName(event.target.value)} required /></div>
        </div>

        <label className="field-label" htmlFor="register-email">Email address</label>
        <div className="input-wrap"><Mail size={17} /><input id="register-email" autoComplete="email" type="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>

        <label className="field-label" htmlFor="register-password">Password</label>
        <div className="input-wrap">
          <LockKeyhole size={17} />
          <input id="register-password" autoComplete="new-password" type={showPassword ? 'text' : 'password'} placeholder="At least 8 characters" value={password} onChange={(event) => setPassword(event.target.value)} required />
          <button className="input-icon-button" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((shown) => !shown)}>
            {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>

        <label className="field-label" htmlFor="confirm-password">Confirm password</label>
        <div className="input-wrap"><LockKeyhole size={17} /><input id="confirm-password" autoComplete="new-password" type={showPassword ? 'text' : 'password'} placeholder="Type it once more" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></div>

        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="auth-submit" type="submit" disabled={loading}>
          {loading ? <><LoaderCircle className="spin" size={16} /> Creating account…</> : <>Create account <ArrowRight size={15} /></>}
        </button>
        <p className="auth-security"><LockKeyhole size={13} /> Your password is encrypted before it is stored.</p>
      </form>
    </AuthShell>
  )
}
