# Simu-SPDA NBR 5419:4 | Simulador de Indução Eletromagnética de SPDA

Este é um simulador de alto desempenho desenvolvido para análise técnica de sistemas de proteção contra descargas atmosféricas (SPDA), com foco em **Laços Elétricos e Indução Magnética** conforme a NBR 5419-4.

## 🚀 Funcionalidades Chave

- **Motor Reativo NBR 5419-3:** Dimensionamento automático de malha e descidas baseado no Nível de Proteção (NP) e dimensões da edificação.
- **Simulação Maxwell-Superposição:** Cálculo do fator de subdivisão de corrente (kc) em tempo real para qualquer ponto de impacto.
- **Visualização 3D de Campos EM:** Renderização volumétrica de campos magnéticos e elétricos ao redor dos condutores ativos.
- **Análise de Laço Vítima:** Dimensionamento de Gaps de isolamento, cálculo de tensão induzida (Uoc) e status de centelhamento/DPS.
- **Cockpit Profissional:** Interface de alta densidade informativa com Glassmorphism e controles precisos de engenharia.

## 🛠️ Tecnologias

- **Frontend:** React + TypeScript + Vite
- **Simulação 3D:** Three.js / React Three Fiber
- **Animação:** Framer Motion
- **Ícones:** Lucide React

## 📦 Como Publicar (Vercel)

1. **GitHub:** 
   - Crie um novo repositório no seu GitHub.
   - Rode os comandos:
     ```bash
     git init
     git add .
     git commit -m "Publicação Master SPDA"
     git remote add origin https://github.com/SEU_USUARIO/SEU_REPO.git
     git push -u origin main
     ```
2. **Vercel:**
   - Acesse [vercel.com](https://vercel.com) e conecte com seu GitHub.
   - Importe este repositório.
   - Clique em **Deploy**.

---
*Desenvolvido para fins didáticos e auditorias técnicas de engenharia.*
