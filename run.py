# run.py
import sys
from api_seeder.main import cli_entry_point

if __name__ == '__main__':
    # Modifie le chemin de recherche de Python pour inclure le dossier 'src'
    # C'est la clé pour que les importations fonctionnent dans l'exécutable
    sys.path.insert(0, 'src')
    
    # Appelle la fonction principale de notre application
    cli_entry_point()