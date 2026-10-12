// components/Logo.tsx
// Identidade visual da SP Contábil: o monograma "SP" com a caneta-tinteiro, pelo ARQUIVO OFICIAL enviado pelo Paulo
// (12/10/2026), em public/logo-sp.png — o mesmo adotado no Consultor DP. Nada de redesenho. O mesmo arquivo gera o
// favicon e o ícone do iPhone (public/favicon.png e public/apple-touch-icon.png).
//
// No modo ícone, o logo fica num quadrado branco de cantos arredondados, como os ícones de app da Apple.

import React from 'react';

interface LogoProps {
  /** Tamanho e extras (classes Tailwind). Padrão: h-14 w-14 */
  className?: string;
  /** Só o ícone, sem o texto ao lado */
  iconOnly?: boolean;
  /** Texto ao lado. Padrão: "SP Contábil" */
  label?: string;
  /** Subtexto. Padrão: "Gestão Financeira" */
  subLabel?: string;
}

const ARQUIVO = `${import.meta.env.BASE_URL}logo-sp.png`;

/** O logo oficial num quadrado branco arredondado (o arquivo já traz a margem). */
const IconeApp: React.FC<{ className?: string }> = ({ className }) => (
  <span className={`inline-block shrink-0 overflow-hidden rounded-[22%] bg-white ring-1 ring-black/5 ${className ?? ''}`}>
    <img src={ARQUIVO} alt="Logo SP Contábil" className="h-full w-full object-contain" draggable={false} />
  </span>
);

const Logo: React.FC<LogoProps> = ({
  className,
  iconOnly = false,
  label = 'SP Contábil',
  subLabel = 'Gestão Financeira',
}) => {
  if (iconOnly) return <IconeApp className={className || 'h-14 w-14'} />;
  return (
    <div className={`inline-flex items-center gap-3 ${className ?? ''}`}>
      <IconeApp className="h-11 w-11" />
      <div className="flex flex-col leading-tight">
        <span className="sp-brand-name text-lg font-semibold tracking-tight">{label}</span>
        <span className="sp-muted mt-0.5 text-xs font-medium">{subLabel}</span>
      </div>
    </div>
  );
};

export default Logo;
