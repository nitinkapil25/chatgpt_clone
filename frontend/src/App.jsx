import { Navigate, Route, Routes } from 'react-router-dom'
import './App.css'
import { useAuth } from './auth/useAuth'
import ChatPage from './pages/ChatPage'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'

function ProtectedChat() {
  const { user } = useAuth()
  return user ? <ChatPage key={user._id} /> : <Navigate to="/login" replace />
}

export default function App() {
  const { user } = useAuth()

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/register" element={user ? <Navigate to="/" replace /> : <RegisterPage />} />
      <Route path="/" element={user ? <ProtectedChat /> : <LandingPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
