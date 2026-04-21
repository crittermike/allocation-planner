import { Home } from './Home';
import Plan from './Plan';
import { usePathname } from './router';

export default function App() {
  const path = usePathname();
  if (path === '/' || path === '') return <Home />;
  const slug = path.replace(/^\/+/, '').replace(/\/.*$/, '');
  if (!slug) return <Home />;
  return <Plan key={slug} slug={slug} />;
}
