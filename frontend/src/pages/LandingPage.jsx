import { ArrowRight, UserRound } from 'lucide-react'
import { Link } from 'react-router-dom'
import OpenAILogo from '../components/OpenAILogo'

export default function LandingPage() {
  return (
    <main className="landing-page">
      <section className="landing-content" aria-labelledby="landing-title">
        <div className="landing-mark"><OpenAILogo size={82} /></div>
        <h1 id="landing-title">ChatGPT Clone</h1>
        <p>Ask anything, brainstorm ideas, or get quick explanations. Your chats stay in the sidebar so you can pick up where you left off.</p>
        <div className="landing-actions">
          <Link className="landing-button landing-button-primary" to="/register">Create account <ArrowRight size={22} strokeWidth={2.2} /></Link>
          <Link className="landing-button landing-button-secondary" to="/login"><UserRound size={22} strokeWidth={1.8} /> Log in</Link>
        </div>
      </section>
    </main>
  )
}
