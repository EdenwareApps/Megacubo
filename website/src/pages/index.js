import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import styles from './index.module.css';

export default function Home() {
  const {siteConfig, i18n} = useDocusaurusContext();
  const isPtBr = i18n.currentLocale === 'pt-BR';

  const title = isPtBr ? 'Megacubo Docs — Português' : siteConfig.title;
  const description = isPtBr
    ? 'Documentação Megacubo em Português para instalação, uso e solução de problemas.'
    : 'Megacubo technical documentation for installation, usage, and troubleshooting.';
  const subtitle = isPtBr
    ? 'Documentação do player IPTV multiplataforma'
    : siteConfig.tagline;
  const buttonText = isPtBr ? 'Abrir Documentação' : 'Open Documentation';

  return (
    <Layout title={title} description={description}>
      <main>
        <header className={styles.heroBanner}>
          <div className="container">
            <h1 className={styles.heroTitle}>{title}</h1>
            <p className={styles.heroSubtitle}>{subtitle}</p>
            <div className={styles.buttons}>
              <Link
                className="button button--primary button--lg"
                to="/docs/introduction"
              >
                {buttonText}
              </Link>
            </div>
          </div>
        </header>
      </main>
    </Layout>
  );
}
