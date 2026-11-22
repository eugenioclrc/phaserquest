import game from './phaser-game';
import Home from './Home';
import Game from './Game';

game.state.add('Home', Home);
game.state.add('Game', Game);
game.state.start('Home');
