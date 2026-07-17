import archive from "./data/archive.json";
import songs01 from "./data/songs-01.json";
import songs02 from "./data/songs-02.json";
import songs03 from "./data/songs-03.json";
import songs04 from "./data/songs-04.json";
import songs05 from "./data/songs-05.json";
import songs06 from "./data/songs-06.json";
import songs07 from "./data/songs-07.json";
import songs08 from "./data/songs-08.json";
import songs09 from "./data/songs-09.json";
import dates01 from "./data/dates-01.json";
import dates02 from "./data/dates-02.json";
import dates03 from "./data/dates-03.json";
import dates04 from "./data/dates-04.json";
import dates05 from "./data/dates-05.json";
import dates06 from "./data/dates-06.json";
import dates07 from "./data/dates-07.json";
import dates08 from "./data/dates-08.json";
import dates09 from "./data/dates-09.json";
import dates10 from "./data/dates-10.json";
import dates11 from "./data/dates-11.json";
import dates12 from "./data/dates-12.json";
import dates13 from "./data/dates-13.json";
import dates14 from "./data/dates-14.json";
import dates15 from "./data/dates-15.json";

const archiveData = { ...archive, songs: [...songs01, ...songs02, ...songs03, ...songs04, ...songs05, ...songs06, ...songs07, ...songs08, ...songs09], dates: [...dates01, ...dates02, ...dates03, ...dates04, ...dates05, ...dates06, ...dates07, ...dates08, ...dates09, ...dates10, ...dates11, ...dates12, ...dates13, ...dates14, ...dates15] };

export default archiveData;
