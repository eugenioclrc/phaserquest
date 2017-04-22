/*
import './phaser-input.min';
import './Being';
import './Human';
import './NPC';
import './Player_client';
import './Monster_client';
import './Item_client';
import './Factory';*/
import game from './phaser-game';
/*import './home';
import './Decoder';
import './main';
import './client';
import './spaceMap';
import './CoDec';
import './AOIutils';
*/

game.state.add('Home', require('./Home').default);
game.state.add('Game', require('./Game').default);
game.state.start('Home');
