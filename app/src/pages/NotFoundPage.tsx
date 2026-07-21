import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return <div className="page not-found"><span>404</span><h1>Route not found</h1><Link className="button button-primary" to="/">Return to overview</Link></div>
}

