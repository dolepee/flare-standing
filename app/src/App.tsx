import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { ProtocolProvider } from './context/ProtocolContext'
import { WalletProvider } from './context/WalletContext'
import { DashboardPage } from './pages/DashboardPage'
import { DemoPage } from './pages/DemoPage'
import { AccessPage } from './pages/AccessPage'
import { CheckoutPage } from './pages/CheckoutPage'
import { EvidencePage } from './pages/EvidencePage'
import { LegacyRecoveryPage } from './pages/LegacyRecoveryPage'
import { MandatesPage } from './pages/MandatesPage'
import { MerchantPage } from './pages/MerchantPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { PlansPage } from './pages/PlansPage'

export default function App() {
  return (
    <BrowserRouter>
      <WalletProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route path="demo" element={<DemoPage />} />
          </Route>
          <Route element={<ProtocolProvider><Layout /></ProtocolProvider>}>
              <Route index element={<DashboardPage />} />
              <Route path="plans" element={<PlansPage />} />
              <Route path="checkout/:planId" element={<CheckoutPage />} />
              <Route path="mandates" element={<MandatesPage />} />
              <Route path="access/:mandateId" element={<AccessPage />} />
              <Route path="merchant" element={<MerchantPage />} />
              <Route path="evidence" element={<EvidencePage />} />
              <Route path="legacy-recovery" element={<LegacyRecoveryPage />} />
              <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </WalletProvider>
    </BrowserRouter>
  )
}
