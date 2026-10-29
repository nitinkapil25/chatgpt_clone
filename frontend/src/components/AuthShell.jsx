import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import OpenAILogo from './OpenAILogo'

export default function AuthShell({ mode, children, notice }) {
  const isLogin = mode === 'login'

  return (
    <main className="auth-page">
      <header className="auth-topbar">
        <Link className="brand-lockup" to="/login" aria-label="GPT Clone home">
          <span className="brand-mark"><OpenAILogo size={17} /></span>
          <span className="brand-name">gpt<span>clone</span></span>
        </Link>
        <span className="auth-top-note">ACCOUNT ACCESS</span>
      </header>

      <section className="auth-content">
        <div className="auth-card">
          <div className="auth-card-heading">
            <span className="eyebrow">{isLogin ? 'WELCOME BACK' : 'NEW ACCOUNT'}</span>
            <h1>{isLogin ? 'Sign in' : 'Create account'}</h1>
            <p>{isLogin ? 'Continue to your workspace.' : 'Set up your account to get started.'}</p>
          </div>
          {notice && <div className="auth-notice" role="status">{notice}</div>}
          {children}
          <div className="auth-switch">
            {isLogin ? "Don't have an account?" : 'Already registered?'}
            <Link to={isLogin ? '/register' : '/login'}>
              {isLogin ? 'Create account' : 'Sign in'} <ArrowRight size={13} />
            </Link>
          </div>
        </div>
      </section>

      <footer className="auth-footer"><span>GPT CLONE</span><span>Account access</span></footer>
    </main>
  )
}
