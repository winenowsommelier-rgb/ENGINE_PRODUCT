'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import styles from './catalog-toolbar.module.css';

interface CatalogToolbarProps {
  title: string;
  hint: string;
  backHref?: string;
}

// Marks <body> so globals.css can hide the site Header/Footer when printing
// this page. The root layout's Header/Footer live outside this component's
// tree, so they can't be omitted from here — this is the surgical way to
// keep them out of the printed PDF without touching print behavior on every
// other page in the site.
const PRINT_DOC_BODY_CLASS = 'catalog-print-doc';

export function CatalogToolbar({ title, hint, backHref = '/catalogs' }: CatalogToolbarProps) {
  useEffect(() => {
    document.body.classList.add(PRINT_DOC_BODY_CLASS);
    return () => document.body.classList.remove(PRINT_DOC_BODY_CLASS);
  }, []);

  return (
    <div className={styles.toolbar}>
      <Link href={backHref} className={styles.back} aria-label="Back to catalog menu">
        ←
      </Link>
      <span className={styles.brand}>{title}</span>
      <button className={styles.printbtn} onClick={() => window.print()} type="button">
        Print / Save PDF
      </button>
      <span className={styles.hint}>{hint}</span>
    </div>
  );
}
