# SKYWING: Vida Selvagem

Simulador 3D contemplativo de voo de pássaro feito com Three.js. Explore um vale vivo com lago, montanhas, florestas, cidades, bandos de aves, sementes, ninhos e térmicas.

## Executar

```bash
pnpm install
pnpm dev       # servidor local de desenvolvimento
pnpm build     # valida TypeScript e gera o build Web
pnpm test      # testes unitários
pnpm smoke     # após o build: fluxo principal em Chromium headless
```

## Aves e voo

Escolha uma das cinco espécies no menu **Escolher ave**. A seleção é salva neste navegador.

- **Sabiá-laranjeira**: equilibrado para explorar.
- **Bem-te-vi**: curvas mais ágeis e recuperação de fôlego melhor.
- **Andorinha**: velocidade máxima maior e asas longas.
- **Arara-canindé**: batidas de asa potentes e boa recuperação.
- **Coruja-buraqueira**: planeio prolongado e rápida recuperação em repouso.

As espécies têm efeitos distintos sobre velocidade, curvas, força das batidas, consumo de fôlego, recuperação e planeio. A opção **Assistência de voo (mais fácil)** suaviza a atitude e ajuda a manter o voo; ela pode ser ajustada em **Configurações**.

O vale tem três assentamentos — **Vale Claro**, **Lago Azul** e **Campina** — com fachadas variadas, janelas com caixilhos e luzes, sacadas, vitrines, marquises, pilastras, cornijas, parapeitos e telhados. Ruas têm faixas, travessias e carros em movimento com carroceria, cabine envidraçada, rodas, faróis e lanternas. O tráfego e os detalhes de fachada aparecem ao se aproximar da cidade para poupar desempenho à distância. Há bandos de **pombos**, **periquitos**, **pardais** e mais aves nos bairros, no rio e no lago. A água tem reflexos móveis, brilhos nas ondas, caústicas rasas e espuma junto às margens.

## Controles

| Ação | Teclado | Celular |
| --- | --- | --- |
| Mergulhar / subir | W / S ou setas ↑ / ↓ | Manche virtual ↑ / ↓ |
| Curvar | A / D ou setas ← / → | Manche virtual ← / → |
| Rolar | Q / E | Curva inclinada pelo manche |
| Bater asas / decolar | Espaço | Segurar **Bater asas** |
| Impulsionar | Shift | Segurar **Impulso** |
| Trocar câmera | C | **Câmera** |
| Alternar cruzeiro automático | F | **Cruzeiro** |
| Pausar / voltar | Esc | **Pausar** |
| Olhar ao redor | Mouse | Câmera de perseguição segue a ave |

No celular, o HUD e os menus se ajustam ao retrato e à paisagem; a renderização começa em qualidade baixa para priorizar fluidez e bateria.

Preferências, espécie escolhida e progresso ficam salvos localmente neste navegador. **Multiplayer online não está ativo nesta versão** e foi adiado; este projeto pode ser ampliado para incluir servidor persistente posteriormente.

## Estrutura principal

- `src/game/flight.ts` — modelo de voo e assistência.
- `src/game/birdSpecies.ts` e `src/game/bird.ts` — espécies, atributos e modelos articulados.
- `src/game/cities.ts` e `src/game/cityLayout.ts` — assentamentos e posicionamento.
- `src/game/fauna.ts` — bandos e outras aves.
- `src/ui/`, `src/styles/`, `src/i18n/` — interface e textos em pt-BR.
- `tests/`, `scripts/smoke.mjs` — testes e validação do fluxo.

Fontes: ManusCC0, licença CC0 1.0; veja `public/fonts/ManusCC0-LICENSE.txt`. Biblioteca gráfica: Three.js (MIT).
