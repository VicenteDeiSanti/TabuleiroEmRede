// Trilha de aprendizado de xadrez: do básico ao avançado.
// Tipos de exercício:
//   square: clique na casa pedida        move: faça um dos lances de `sol`
//   mate:   dê xeque-mate em 1 lance     line: jogue a sequência (o app responde pelo adversário)
//   demo:   assista à sequência lance a lance
// Posição inicial do exercício: `fen` ou `moves` (lances a partir da posição inicial).
window.LESSON_MODULES = [
  {
    id: 'fundamentos', title: 'Fundamentos', level: 'Iniciante',
    desc: 'O tabuleiro, como cada peça se move e quanto ela vale.',
    lessons: [
      {
        id: 'tabuleiro', title: 'O tabuleiro', desc: 'Casas, colunas, fileiras e coordenadas.',
        text: [
          'O tabuleiro tem 64 casas, alternando claras e escuras. Ele sempre fica posicionado com uma casa clara no canto inferior direito de cada jogador.',
          'As colunas são as letras de a até h, da esquerda para a direita (do lado das brancas). As fileiras são os números de 1 a 8, de baixo para cima. Cada casa tem um nome: a letra da coluna seguida do número da fileira, como e4 ou d5.',
          'As brancas começam nas fileiras 1 e 2; as pretas, nas fileiras 7 e 8. As brancas sempre fazem o primeiro lance.'
        ],
        ex: [
          { t: 'square', prompt: 'Clique na casa e4.', sq: 'e4' },
          { t: 'square', prompt: 'Clique na casa d5.', sq: 'd5' },
          { t: 'square', prompt: 'Clique na casa h1, o canto onde fica a torre do rei das brancas.', sq: 'h1' },
          { t: 'square', prompt: 'Onde fica a dama preta no início da partida? Clique nela.', sq: 'd8' }
        ]
      },
      {
        id: 'torre', title: 'A torre', desc: 'Linhas retas, quantas casas quiser.',
        text: [
          'A torre anda em linha reta: na vertical (colunas) ou na horizontal (fileiras), quantas casas quiser, mas não pode pular outras peças.',
          'Ela captura tomando o lugar da peça adversária que estiver no seu caminho. A torre vale cerca de 5 peões.'
        ],
        ex: [
          { t: 'move', prompt: 'Capture o cavalo preto com a torre.', fen: '3n4/8/8/8/3R4/8/8/K6k w - - 0 1', sol: ['Rxd8'] },
          { t: 'move', prompt: 'Agora capture o peão preto, andando pela fileira.', fen: '7k/8/8/8/1R4p1/8/8/K7 w - - 0 1', sol: ['Rxg4'] }
        ]
      },
      {
        id: 'bispo', title: 'O bispo', desc: 'Diagonais e a cor das casas.',
        text: [
          'O bispo anda na diagonal, quantas casas quiser, sem pular peças. Por isso um bispo nunca muda de cor: o bispo que começa em casa clara fica a partida toda nas casas claras.',
          'Cada lado tem um bispo de casas claras e um de casas escuras. O bispo vale cerca de 3 peões.'
        ],
        ex: [
          { t: 'move', prompt: 'Capture o cavalo com o bispo.', fen: '7k/8/7n/8/8/8/8/K1B5 w - - 0 1', sol: ['Bxh6'] },
          { t: 'move', prompt: 'Capture a torre com o bispo.', fen: '7k/8/r7/8/8/8/8/K4B2 w - - 0 1', sol: ['Bxa6'] }
        ]
      },
      {
        id: 'dama', title: 'A dama', desc: 'A peça mais forte: torre + bispo.',
        text: [
          'A dama junta os movimentos da torre e do bispo: anda em linha reta ou na diagonal, quantas casas quiser.',
          'É a peça mais poderosa e vale cerca de 9 peões. Por isso, perder a dama sem compensação quase sempre perde a partida.'
        ],
        ex: [
          { t: 'move', prompt: 'Capture a torre preta com a dama.', fen: '7k/8/8/7r/8/8/8/K2Q4 w - - 0 1', sol: ['Qxh5'] },
          { t: 'move', prompt: 'Capture a torre da última fileira.', fen: '3r3k/8/8/8/8/8/8/K2Q4 w - - 0 1', sol: ['Qxd8+'] }
        ]
      },
      {
        id: 'cavalo', title: 'O cavalo', desc: 'O salto em "L" por cima das peças.',
        text: [
          'O cavalo anda em "L": duas casas numa direção e uma para o lado. É a única peça que pode pular outras peças.',
          'A cada salto o cavalo muda de cor de casa. Ele vale cerca de 3 peões e é muito forte no centro do tabuleiro, de onde alcança até 8 casas.'
        ],
        ex: [
          { t: 'move', prompt: 'Capture o peão com o cavalo.', fen: '7k/8/8/8/8/5p2/8/K5N1 w - - 0 1', sol: ['Nxf3'] },
          { t: 'move', prompt: 'Na posição inicial, só os cavalos podem pular os peões. Faça um lance de cavalo.', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', sol: ['Nf3', 'Nc3', 'Na3', 'Nh3'] }
        ]
      },
      {
        id: 'rei', title: 'O rei', desc: 'Uma casa por vez, e nunca em perigo.',
        text: [
          'O rei anda uma casa em qualquer direção. Ele nunca pode ir para uma casa atacada pelo adversário, e os dois reis nunca ficam lado a lado.',
          'O rei não tem valor em pontos: se ele for capturado, a partida acaba. Ainda assim, ele também captura peças, desde que elas não estejam protegidas.'
        ],
        ex: [
          { t: 'move', prompt: 'A torre preta está desprotegida, colada no seu rei. Capture-a.', fen: 'k7/8/8/8/8/8/1r6/K7 w - - 0 1', sol: ['Kxb2'] }
        ]
      },
      {
        id: 'peao', title: 'O peão', desc: 'Anda para frente, captura na diagonal.',
        text: [
          'O peão anda uma casa para frente. No seu primeiro lance, pode andar duas casas. Ele nunca anda para trás.',
          'O peão é a única peça que captura de forma diferente de como anda: captura uma casa na diagonal, para frente. Vale 1 ponto, mas não o subestime: um peão que chega à última fileira vira outra peça.'
        ],
        ex: [
          { t: 'move', prompt: 'Avance o peão duas casas.', fen: '7k/8/8/8/8/8/4P3/K7 w - - 0 1', sol: ['e4'] },
          { t: 'move', prompt: 'O peão ataca duas peças. Capture a mais valiosa.', fen: '7k/8/8/3n1r2/4P3/8/8/K7 w - - 0 1', sol: ['exf5'] }
        ]
      },
      {
        id: 'valor', title: 'Valor das peças', desc: 'Peão 1, cavalo 3, bispo 3, torre 5, dama 9.',
        text: [
          'Use os valores para decidir trocas: peão = 1, cavalo = 3, bispo = 3, torre = 5, dama = 9.',
          'Trocar um cavalo (3) por uma torre (5) é bom negócio. Entregar a dama (9) por uma torre (5) é ruim, a menos que isso leve a um xeque-mate.',
          'Antes de capturar, pergunte: a peça está protegida? Se estiver, compare o valor do que você entrega com o que você ganha.'
        ],
        ex: [
          { t: 'move', prompt: 'O cavalo ataca a torre e a dama. Capture a peça de maior valor.', fen: '7k/8/5q2/2r5/4N3/8/8/K7 w - - 0 1', sol: ['Nxf6'] },
          { t: 'move', prompt: 'O bispo preto está protegido pelo peão; o cavalo, não. Capture a peça que está solta.', fen: '6k1/8/4p3/3b4/8/8/8/K2R2n1 w - - 0 1', sol: ['Rxg1'] }
        ]
      }
    ]
  },
  {
    id: 'regras', title: 'Regras especiais', level: 'Iniciante',
    desc: 'Roque, en passant, promoção, xeque, mate e empates.',
    lessons: [
      {
        id: 'roque', title: 'O roque', desc: 'Rei protegido e torre em jogo num lance só.',
        text: [
          'No roque, o rei anda duas casas em direção a uma torre, e a torre pula para o outro lado do rei. É o único lance em que duas peças se movem.',
          'Roque pequeno (O-O): para o lado do rei. Roque grande (O-O-O): para o lado da dama.',
          'Condições: o rei e a torre ainda não se moveram; não há peças entre eles; o rei não está em xeque, não passa por casa atacada e não termina em xeque. Para rocar, mova o rei duas casas.'
        ],
        ex: [
          { t: 'move', prompt: 'Faça o roque pequeno (mova o rei duas casas para a direita).', fen: 'r3k2r/pppq1ppp/2npbn2/2b1p3/2B1P3/2NPBN2/PPPQ1PPP/R3K2R w KQkq - 0 1', sol: ['O-O'] },
          { t: 'move', prompt: 'Agora você joga com as pretas: faça o roque grande.', fen: 'r3k2r/pppq1ppp/2npbn2/2b1p3/2B1P3/2NPBN2/PPPQ1PPP/R4RK1 b kq - 1 1', sol: ['O-O-O'] }
        ]
      },
      {
        id: 'en-passant', title: 'En passant', desc: 'A captura "de passagem" do peão.',
        text: [
          'Se um peão adversário avança duas casas e para ao lado do seu peão, você pode capturá-lo como se ele tivesse andado só uma casa.',
          'Essa captura só pode ser feita imediatamente, no lance seguinte. Se você deixar passar, perde o direito.'
        ],
        ex: [
          { t: 'move', prompt: 'As pretas acabaram de jogar d7-d5. Capture en passant.', fen: 'k7/8/8/3pP3/8/8/8/K7 w - d6 0 1', sol: ['exd6'] }
        ]
      },
      {
        id: 'promocao', title: 'Promoção', desc: 'O peão que vira dama.',
        text: [
          'Quando um peão chega à última fileira, ele é promovido: vira dama, torre, bispo ou cavalo, à sua escolha. Quase sempre a escolha é a dama.',
          'Por isso peões avançados são perigosos: no final da partida, a corrida para promover decide muitos jogos.'
        ],
        ex: [
          { t: 'move', prompt: 'Promova o peão a dama.', fen: 'k7/4P3/8/8/8/8/8/K7 w - - 0 1', sol: ['e8=Q'] },
          { t: 'mate', prompt: 'Promova e dê xeque-mate.', fen: '6k1/3P1ppp/8/8/8/8/8/K7 w - - 0 1' }
        ]
      },
      {
        id: 'xeque', title: 'Xeque', desc: 'Três formas de se defender.',
        text: [
          'Xeque é quando o rei está sendo atacado. Você é obrigado a resolver o xeque imediatamente, de uma destas três formas:',
          '1) mover o rei para uma casa segura; 2) bloquear o ataque colocando uma peça no caminho; 3) capturar a peça que dá o xeque.'
        ],
        ex: [
          { t: 'move', prompt: 'A torre dá xeque. Bloqueie com o bispo numa casa protegida pelo rei.', fen: '4r1k1/8/8/8/8/8/8/3BK3 w - - 0 1', sol: ['Be2'] },
          { t: 'move', prompt: 'O cavalo dá xeque. Capture-o.', fen: '6k1/8/8/8/8/5n2/8/3QK3 w - - 0 1', sol: ['Qxf3'] }
        ]
      },
      {
        id: 'xeque-mate', title: 'Xeque-mate', desc: 'O objetivo do jogo.',
        text: [
          'Xeque-mate é um xeque do qual não há saída: o rei não pode fugir, não dá para bloquear e não dá para capturar quem ataca. Quem leva mate perde.',
          'Muitos mates acontecem com o rei preso na beira do tabuleiro. Procure sempre os xeques: eles são os lances mais forçantes.'
        ],
        ex: [
          { t: 'mate', prompt: 'Dê xeque-mate em 1 lance.', fen: 'k7/8/1K6/8/8/8/8/7R w - - 0 1' },
          { t: 'mate', prompt: 'Dê xeque-mate em 1 lance.', fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1' }
        ]
      },
      {
        id: 'empates', title: 'Empates', desc: 'Afogamento e outras formas de empatar.',
        text: [
          'Afogamento: o jogador da vez não está em xeque, mas não tem nenhum lance legal. A partida termina empatada, mesmo que um lado tenha muito mais material.',
          'Outros empates: acordo entre os jogadores; repetição da mesma posição três vezes; 50 lances de cada lado sem captura nem lance de peão; material insuficiente para dar mate (por exemplo, rei contra rei).',
          'Quando estiver ganhando, cuidado para não afogar o rei adversário!'
        ],
        ex: [
          { t: 'mate', prompt: 'Dê xeque-mate, mas cuidado com o afogamento.', fen: 'k7/8/2K5/8/8/8/8/1Q6 w - - 0 1' }
        ]
      }
    ]
  },
  {
    id: 'mates', title: 'Primeiros mates', level: 'Iniciante',
    desc: 'Padrões de mate que todo jogador precisa conhecer.',
    lessons: [
      {
        id: 'corredor', title: 'Mate do corredor', desc: 'O rei preso atrás dos próprios peões.',
        text: [
          'O rei rocado atrás de três peões que não se moveram fica sem casas de fuga. Uma torre ou dama na última fileira dá mate.',
          'Para se proteger, crie uma "casa de escape" avançando um desses peões (por exemplo, h3 ou h6) quando tiver tempo.'
        ],
        ex: [
          { t: 'mate', prompt: 'Dê o mate do corredor.', fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1' },
          { t: 'mate', prompt: 'A torre preta defende a última fileira. Elimine o defensor dando mate.', fen: '4r1k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1' }
        ]
      },
      {
        id: 'mate-dama', title: 'Mate com dama e rei', desc: 'A dama empurra, o rei ajuda.',
        text: [
          'Com dama e rei contra rei sozinho, a técnica é usar a dama para encurralar o rei adversário na beira do tabuleiro, sempre a um salto de cavalo de distância dele, sem dar xeque à toa.',
          'Depois traga o seu rei para perto: a dama dá o mate protegida pelo rei ou na beira do tabuleiro.'
        ],
        ex: [
          { t: 'mate', prompt: 'Dê xeque-mate.', fen: '7k/8/6K1/8/8/8/Q7/8 w - - 0 1' },
          { t: 'mate', prompt: 'Dê xeque-mate.', fen: 'k7/2Q5/1K6/8/8/8/8/8 w - - 0 1' }
        ]
      },
      {
        id: 'duas-torres', title: 'Mate da escada', desc: 'Duas torres se revezando.',
        text: [
          'Com duas torres, uma corta uma fileira e a outra dá xeque na fileira seguinte. Elas se revezam como degraus de uma escada até o rei chegar na beira.',
          'Mantenha as torres longe do rei adversário, para ele não poder capturá-las.'
        ],
        ex: [
          { t: 'mate', prompt: 'A torre de h7 corta a fuga. Dê o mate com a outra.', fen: 'k7/7R/8/8/8/8/8/K5R1 w - - 0 1' },
          { t: 'mate', prompt: 'Dê o mate da escada.', fen: '6k1/R7/8/8/8/8/8/1R4K1 w - - 0 1' }
        ]
      },
      {
        id: 'pastor', title: 'Mate do pastor', desc: 'O ataque em f7 e como se defender.',
        text: [
          'A casa f7 (f2 para as brancas) é a mais fraca no começo: só o rei a defende. O mate do pastor ataca f7 com a dama e o bispo.',
          'É um truque para iniciantes: contra um adversário atento, a dama exposta perde tempo. Mas você precisa saber se defender dele.'
        ],
        ex: [
          { t: 'line', prompt: 'Jogue o mate do pastor com as brancas (o app responde pelas pretas).', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', line: ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'] },
          { t: 'move', prompt: 'Agora você é as pretas: a dama e o bispo miram f7. Defenda e, se puder, ataque a dama.', moves: 'e4 e5 Bc4 Nc6 Qh5', sol: ['g6', 'Qe7', 'Qf6'] }
        ]
      }
    ]
  },
  {
    id: 'abertura', title: 'Princípios de abertura', level: 'Iniciante',
    desc: 'Centro, desenvolvimento, roque e as armadilhas clássicas.',
    lessons: [
      {
        id: 'centro', title: 'Controle o centro', desc: 'As casas e4, d4, e5 e d5.',
        text: [
          'As quatro casas centrais (e4, d4, e5, d5) são as mais importantes. Peças no centro alcançam mais casas e chegam rápido aos dois lados do tabuleiro.',
          'Os lances de abertura mais populares, 1.e4 e 1.d4, ocupam o centro com um peão e ainda abrem caminho para o bispo e a dama.'
        ],
        ex: [
          { t: 'move', prompt: 'Abra a partida ocupando o centro com um peão.', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', sol: ['e4', 'd4'] },
          { t: 'move', prompt: 'As brancas jogaram 1.e4. Responda disputando o centro com um peão.', moves: 'e4', sol: ['e5', 'c5', 'd5', 'e6', 'c6'] }
        ]
      },
      {
        id: 'desenvolvimento', title: 'Desenvolva as peças', desc: 'Cavalos e bispos para fora, rápido.',
        text: [
          'Desenvolver é tirar cavalos e bispos das casas iniciais para posições ativas. Regra prática: cavalos antes dos bispos, e evite mover a mesma peça duas vezes na abertura.',
          'Cada lance de desenvolvimento que ameaça algo (como atacar um peão) ganha tempo, porque obriga o adversário a responder.'
        ],
        ex: [
          { t: 'move', prompt: 'Desenvolva um cavalo atacando o peão de e5.', moves: 'e4 e5', sol: ['Nf3'] },
          { t: 'move', prompt: 'Agora desenvolva o bispo para uma casa ativa.', moves: 'e4 e5 Nf3 Nc6', sol: ['Bc4', 'Bb5'] }
        ]
      },
      {
        id: 'seguranca-rei', title: 'Proteja o rei', desc: 'Roque cedo.',
        text: [
          'Com o centro abrindo, o rei no meio do tabuleiro vira alvo. Faça o roque nos primeiros 10 lances, na maioria das partidas.',
          'Depois do roque, evite avançar os peões na frente do rei sem motivo: cada avanço cria buracos.'
        ],
        ex: [
          { t: 'move', prompt: 'Peças desenvolvidas: coloque o rei em segurança.', moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5 d3 Nf6', sol: ['O-O'] }
        ]
      },
      {
        id: 'armadilhas', title: 'Armadilhas clássicas', desc: 'Mate do louco e o mate de Légal.',
        text: [
          'Mate do louco: o mate mais rápido possível, em 2 lances. Acontece quando as brancas enfraquecem a diagonal do rei com f3 e g4.',
          'Mate de Légal: as pretas cravam o cavalo contra a dama, mas o cavalo "cravado" pula mesmo assim. Se as pretas capturarem a dama, levam mate. Lição: uma cravada contra a dama não é absoluta.'
        ],
        ex: [
          { t: 'line', prompt: 'Você é as pretas. Puna os lances fracos das brancas com o mate do louco.', moves: 'f3', line: ['e5', 'g4', 'Qh4#'] },
          { t: 'line', prompt: 'Você é as brancas. Jogue o mate de Légal: ignore a cravada e capture em e5.', moves: 'e4 e5 Nf3 d6 Bc4 Bg4 Nc3 g6', line: ['Nxe5', 'Bxd1', 'Bxf7+', 'Ke7', 'Nd5#'] }
        ]
      }
    ]
  },
  {
    id: 'taticas', title: 'Táticas', level: 'Intermediário',
    desc: 'Garfo, cravada, espeto e ataque descoberto.',
    lessons: [
      {
        id: 'garfo', title: 'Garfo', desc: 'Uma peça atacando duas.',
        text: [
          'Garfo (ou ataque duplo) é quando uma peça ataca duas peças adversárias ao mesmo tempo. O adversário só consegue salvar uma.',
          'O cavalo é o rei dos garfos, porque ataca em casas que as outras peças não alcançam. Peões também dão ótimos garfos.'
        ],
        ex: [
          { t: 'move', prompt: 'Encontre o garfo de cavalo que ganha a dama.', fen: '3q3k/6pp/8/4N3/8/8/6PP/6K1 w - - 0 1', sol: ['Nf7+'] },
          { t: 'move', prompt: 'Encontre o garfo de peão.', fen: 'k7/8/8/2n1n3/8/3P4/8/7K w - - 0 1', sol: ['d4'] }
        ]
      },
      {
        id: 'cravada', title: 'Cravada', desc: 'A peça que não pode sair do lugar.',
        text: [
          'Na cravada, uma peça não pode se mover porque deixaria exposta outra mais valiosa atrás dela. Se a peça de trás for o rei, a cravada é absoluta: mover a peça cravada seria ilegal.',
          'Ataque a peça cravada com mais peças: ela não pode fugir.'
        ],
        ex: [
          { t: 'move', prompt: 'Crave a dama preta contra o rei e ganhe-a.', fen: '4k3/8/4q3/8/8/8/5K2/R7 w - - 0 1', sol: ['Re1'] }
        ]
      },
      {
        id: 'espeto', title: 'Espeto', desc: 'A cravada ao contrário.',
        text: [
          'No espeto, você ataca uma peça valiosa (geralmente o rei com xeque) e, quando ela sai da frente, captura a peça que estava atrás.',
          'Procure reis e damas na mesma linha, coluna ou diagonal.'
        ],
        ex: [
          { t: 'move', prompt: 'O rei e a dama pretos estão na mesma fileira. Dê o espeto.', fen: '8/8/8/q2k4/8/8/8/6KR w - - 0 1', sol: ['Rh5+'] }
        ]
      },
      {
        id: 'descoberto', title: 'Ataque descoberto', desc: 'Mova uma peça, revele outra.',
        text: [
          'No ataque descoberto, você move uma peça e "abre" a linha de outra que estava atrás. Se a peça que se move também ataca algo (ou dá xeque), o adversário enfrenta duas ameaças de uma vez.',
          'O xeque descoberto é dos golpes mais fortes do xadrez.'
        ],
        ex: [
          { t: 'move', prompt: 'O bispo tapa a torre que mira a dama. Tire o bispo com xeque e ganhe a dama.', fen: '4q1k1/6pp/8/8/4B3/8/8/4R1K1 w - - 0 1', sol: ['Bd5+', 'Bxh7+'] }
        ]
      },
      {
        id: 'mate-abafado', title: 'Mate abafado', desc: 'Sacrifício de dama e mate de cavalo.',
        text: [
          'No mate abafado, o rei está cercado pelas próprias peças e um cavalo dá o mate. O padrão clássico sacrifica a dama para obrigar uma peça adversária a fechar a última casa de fuga.',
          'Calcule as sequências forçadas: xeque, resposta obrigatória, xeque, até o mate.'
        ],
        ex: [
          { t: 'line', prompt: 'Mate em 2: sacrifique a dama e dê o mate abafado.', fen: 'r6k/6pp/7N/8/8/1Q6/8/6K1 w - - 0 1', line: ['Qg8+', 'Rxg8', 'Nf7#'] }
        ]
      }
    ]
  },
  {
    id: 'finais', title: 'Finais essenciais', level: 'Intermediário',
    desc: 'Quadrado do peão, oposição e finais de torre.',
    lessons: [
      {
        id: 'quadrado', title: 'Regra do quadrado', desc: 'O rei alcança o peão?',
        text: [
          'Imagine um quadrado com um lado indo do peão até a casa de promoção. Se o rei adversário consegue entrar nesse quadrado no seu lance, ele alcança o peão. Se não, o peão promove sozinho.',
          'Essa conta rápida evita calcular lance por lance.'
        ],
        ex: [
          { t: 'move', prompt: 'O rei preto está fora do quadrado do peão. Corra com o peão!', fen: '7k/8/8/8/1P6/8/8/K7 w - - 0 1', sol: ['b5'] }
        ]
      },
      {
        id: 'oposicao', title: 'Oposição', desc: 'O duelo dos reis no final de peão.',
        text: [
          'Nos finais de rei e peão, os reis frente a frente com uma casa entre eles estão em oposição. Quem NÃO tem a vez de jogar "tem a oposição" e obriga o outro rei a ceder espaço.',
          'Para promover o peão, o seu rei precisa ir na frente dele e ganhar a oposição. Com o rei na sexta fileira à frente do peão, a vitória é garantida.'
        ],
        ex: [
          { t: 'move', prompt: 'Só um lance vence: tome a oposição na frente do peão.', fen: '8/4k3/8/5K2/4P3/8/8/8 w - - 0 1', sol: ['Ke5'] },
          { t: 'move', prompt: 'Rei na sexta fileira à frente do peão: dê a volta pelo lado para abrir caminho.', fen: '4k3/8/4K3/4P3/8/8/8/8 w - - 0 1', sol: ['Kd6', 'Kf6'] }
        ]
      },
      {
        id: 'lucena', title: 'Lucena: construindo a ponte', desc: 'Como vencer o final de torre com peão.',
        text: [
          'Na posição de Lucena, o seu peão está na sétima fileira, o seu rei na casa de promoção, e a torre adversária dá xeques pelo lado.',
          'A técnica: afaste o rei adversário com um xeque, coloque a torre na quarta fileira e saia com o rei. Quando os xeques vierem, a torre bloqueia: é a "ponte".'
        ],
        ex: [
          { t: 'demo', prompt: 'Acompanhe a construção da ponte.', fen: '1K6/1P1k4/8/8/8/8/r7/2R5 w - - 0 1', line: ['Rd1+', 'Ke7', 'Rd4', 'Rb2', 'Kc7', 'Rc2+', 'Kb6', 'Rb2+', 'Kc6', 'Rc2+', 'Kb5', 'Rb2+', 'Rb4'] }
        ]
      },
      {
        id: 'philidor', title: 'Philidor: a defesa', desc: 'Como empatar o final de torre.',
        text: [
          'Se você defende contra torre e peão, mantenha a torre na terceira fileira (a sexta, do ponto de vista do atacante) para impedir que o rei adversário avance.',
          'Quando o peão avançar até essa fileira, o rei atacante fica sem abrigo: leve a torre para a primeira fileira e dê xeques por trás.'
        ],
        ex: [
          { t: 'demo', prompt: 'A torre preta espera na sexta fileira. Quando o peão avança, ela vai para trás e dá xeques.', fen: '4k3/8/1r6/4PK2/8/8/8/7R w - - 0 1', line: ['e6', 'Rb1', 'Kf6', 'Rf1+'] }
        ]
      }
    ]
  },
  {
    id: 'meio-jogo', title: 'Meio-jogo e estratégia', level: 'Intermediário',
    desc: 'Colunas abertas, postos avançados, estrutura de peões e planos.',
    lessons: [
      {
        id: 'colunas', title: 'Colunas abertas', desc: 'Onde as torres devem ficar.',
        text: [
          'Uma coluna sem peões é uma coluna aberta. Torres em colunas abertas ganham espaço e podem invadir a sétima fileira adversária.',
          'Se as duas torres estiverem na mesma coluna (dobradas), a pressão dobra.'
        ],
        ex: [
          { t: 'move', prompt: 'As colunas c e d estão abertas. Coloque uma torre numa delas.', fen: '2r2rk1/pp3ppp/2n1pn2/8/8/2N1PN2/PP3PPP/R4RK1 w - - 0 1', sol: ['Rfd1', 'Rad1', 'Rfc1', 'Rac1'] }
        ]
      },
      {
        id: 'postos', title: 'Postos avançados', desc: 'Casas que os peões adversários não atacam.',
        text: [
          'Um posto avançado é uma casa no campo adversário que nenhum peão inimigo consegue atacar. Um cavalo instalado ali é muito forte e difícil de expulsar.',
          'Na estrutura da Siciliana com ...e5, a casa d5 é o posto avançado clássico das brancas.'
        ],
        ex: [
          { t: 'move', prompt: 'Nenhum peão preto pode atacar d5. Leve o cavalo para lá.', fen: 'r1bq1rk1/1p2bppp/p2p1n2/4p3/4P3/2N2N2/PPP1BPPP/R2Q1RK1 w - - 0 1', sol: ['Nd5'] }
        ]
      },
      {
        id: 'estrutura', title: 'Estrutura de peões', desc: 'Isolados, dobrados e passados.',
        text: [
          'Peão isolado: não tem peões vizinhos para protegê-lo. Dá atividade às peças, mas vira alvo no final.',
          'Peões dobrados: dois peões na mesma coluna. Costumam ser fracos, mas abrem colunas para as torres.',
          'Peão passado: nenhum peão adversário pode pará-lo. É uma grande vantagem, especialmente no final: "peão passado deve avançar".'
        ],
        ex: [
          { t: 'move', prompt: 'Crie um peão passado: capture de forma que o seu peão fique sem adversários na frente.', fen: '6k1/5ppp/8/2p5/1P6/8/5PPP/6K1 w - - 0 1', sol: ['bxc5'] }
        ]
      },
      {
        id: 'plano', title: 'Como achar um plano', desc: 'Lances candidatos e a ordem certa de pensar.',
        text: [
          'A cada lance, siga uma rotina: 1) O que o adversário ameaça? 2) Existem lances forçantes para mim (xeques, capturas, ameaças)? 3) Qual é a minha pior peça e como melhorá-la?',
          'Faça uma lista de 2 ou 3 lances candidatos antes de escolher. Isso evita jogar o primeiro lance que aparece.',
          'Profilaxia: às vezes o melhor lance é impedir o plano do adversário antes que ele aconteça, como criar uma casa de escape para o rei.'
        ],
        ex: [
          { t: 'move', prompt: 'Não há nada urgente, mas o seu rei pode levar mate do corredor no futuro. Crie uma casa de escape.', fen: 'r5k1/5pp1/7p/8/8/8/5PPP/4R1K1 w - - 0 1', sol: ['h3', 'g3', 'h4', 'f3'] }
        ]
      }
    ]
  },
  {
    id: 'avancado', title: 'Avançado', level: 'Avançado',
    desc: 'Sacrifícios, cálculo e como continuar evoluindo.',
    lessons: [
      {
        id: 'grego', title: 'O presente grego', desc: 'O sacrifício Bxh7+.',
        text: [
          'O "presente grego" é o sacrifício do bispo em h7 contra o rei rocado. Depois de Bxh7+ Kxh7, o cavalo salta para g5 com xeque e a dama chega em h5, ameaçando mate.',
          'Ingredientes: bispo em d3, cavalo que alcança g5, dama que chega em h5, e as pretas sem cavalo em f6 para defender h7. Calcule bem: se faltar um ingrediente, o sacrifício falha.'
        ],
        ex: [
          { t: 'line', prompt: 'Jogue o presente grego (o app responde com a linha principal das pretas). No fim, a dama e o cavalo ameaçam mate em h7.', fen: 'rnbq1rk1/pp3ppp/4p3/3pP3/1b1P4/3B1N2/PP3PPP/RNBQ1RK1 w - - 0 1', line: ['Bxh7+', 'Kxh7', 'Ng5+', 'Kg8', 'Qh5'] }
        ]
      },
      {
        id: 'calculo', title: 'Cálculo', desc: 'Xeques, capturas e ameaças, nessa ordem.',
        text: [
          'Em posições táticas, examine primeiro os lances forçantes: xeques, depois capturas, depois ameaças. Eles limitam as respostas do adversário e tornam o cálculo possível.',
          'Visualize a posição final de cada linha e pergunte: o que o adversário pode fazer de melhor aqui? Não pare de calcular no lance que parece bom para você.'
        ],
        ex: [
          { t: 'mate', prompt: 'Você é as pretas. Procure os xeques primeiro: há mate em 1.', fen: '6k1/1b3ppp/8/6q1/8/8/5PPP/6K1 b - - 0 1' },
          { t: 'line', prompt: 'Mate em 2: sacrifique a dama para desviar o defensor da última fileira.', fen: 'r5k1/5ppp/8/8/8/8/1Q3PPP/1R4K1 w - - 0 1', line: ['Qb8+', 'Rxb8', 'Rxb8#'] }
        ]
      },
      {
        id: 'estudo', title: 'Como continuar evoluindo', desc: 'Um método de estudo.',
        text: [
          'Jogue partidas mais longas (10 + 0 ou mais) e analise cada uma depois. Use "Rever partida" e "Exportar" no Tabuleiro em Rede, e cole o PGN no lichess.org/analysis para ver onde errou.',
          'Resolva táticas todo dia, 15 minutos. Reconhecer padrões é o que mais faz um jogador subir de nível.',
          'Escolha um repertório pequeno na biblioteca de aberturas: uma abertura com as brancas, uma resposta a 1.e4 e uma a 1.d4. Treine as linhas e, principalmente, entenda as ideias.',
          'Estude finais: Lucena, Philidor e oposição aparecem muito mais do que parece.'
        ],
        ex: []
      }
    ]
  }
];
