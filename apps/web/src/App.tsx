import { LegalGate } from './components/LegalGate';
import { MeProvider } from './components/MeContext';
import { AdminBugPage } from './pages/AdminBugPage';
import { AdminPage } from './pages/AdminPage';
import { CustomerPage } from './pages/CustomerPage';
import { CustomersPage } from './pages/CustomersPage';
import { EmitterPage } from './pages/EmitterPage';
import { EmittersPage } from './pages/EmittersPage';
import { HomePage } from './pages/HomePage';
import { InvoiceDetailPage } from './pages/InvoiceDetailPage';
import { InvoicesPage } from './pages/InvoicesPage';
import { IssuePage } from './pages/IssuePage';
import { MembersPage } from './pages/MembersPage';
import { LoginPage } from './pages/LoginPage';
import { NewInvoicePage } from './pages/NewInvoicePage';
import { OnboardingPage } from './pages/onboarding/OnboardingPage';
import { ProfilePage } from './pages/ProfilePage';
import { ResetPage } from './pages/ResetPage';
import { SignupPage } from './pages/SignupPage';
import { type Route, useRoute } from './router';

export function App() {
  const route = useRoute();
  // The pages before a session render outside MeProvider; entering the app mounts it, so /api/me is fresh.
  switch (route.name) {
    case 'login':
      return <LoginPage />;
    case 'signup':
      return <SignupPage />;
    case 'reset':
      return <ResetPage />;
    default:
      return (
        <MeProvider>
          <LegalGate>
            <Screen route={route} />
          </LegalGate>
        </MeProvider>
      );
  }
}

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'emitters':
      return <EmittersPage accountId={route.accountId} />;
    case 'emitter':
      return <EmitterPage accountId={route.accountId} emitterId={route.emitterId} />;
    case 'invoices':
      return <InvoicesPage accountId={route.accountId} />;
    case 'invoice':
      return <InvoiceDetailPage accountId={route.accountId} invoiceId={route.invoiceId} />;
    case 'newInvoice':
      return (
        <NewInvoicePage
          accountId={route.accountId}
          {...(route.customerId ? { customerId: route.customerId } : {})}
        />
      );
    case 'issue':
      return <IssuePage accountId={route.accountId} invoiceId={route.invoiceId} />;
    case 'customers':
      return <CustomersPage accountId={route.accountId} />;
    case 'customer':
      return <CustomerPage accountId={route.accountId} customerId={route.customerId} />;
    case 'members':
      return <MembersPage accountId={route.accountId} />;
    case 'admin':
      return <AdminPage />;
    case 'adminBug':
      return <AdminBugPage reportId={route.reportId} />;
    case 'profile':
      return <ProfilePage />;
    case 'onboarding':
      return <OnboardingPage {...(route.accountId ? { accountId: route.accountId } : {})} />;
    default:
      return <HomePage />;
  }
}
